#!/usr/bin/env bash
# =============================================================================
# collect_supabase.sh — Supabase 專案盤點採集腳本（deterministic, read-only）
#
# 產出：$OUT_DIR/manifest.json  （每個項目都帶 source，模型不得補填）
#       $OUT_DIR/raw/**          （所有原始輸出，供人工/二次驗證比對）
#
# 必要環境變數：
#   SUPABASE_ACCESS_TOKEN   Personal access token（Management API）
#   SUPABASE_PROJECT_REF    專案 ref（URL 上那段 20 碼）
#   SUPABASE_DB_URL         Postgres 連線字串（建議 session pooler, 唯讀角色亦可）
# 選用：
#   CODE_DIR                要掃的程式碟根目錄（預設 .）
#   OUT_DIR                 輸出目錄（預設 ./supabase-inventory）
#
# 原則：
#   - 只讀。不 dump 資料（--schema-only）、不寫任何遠端資源。
#   - preflight 任一失敗即中止（fail-closed），不做「能做多少算多少」。
#   - secrets 只留名稱，值一律剔除。
#   - Management API 個別 endpoint 失敗不中止，但記錄 http status 進 manifest.errors。
# =============================================================================
set -euo pipefail

OUT_DIR="${OUT_DIR:-./supabase-inventory}"
CODE_DIR="${CODE_DIR:-.}"
RAW="$OUT_DIR/raw"
API="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF:-}"
mkdir -p "$RAW/db" "$RAW/api" "$RAW/code"

log()  { printf '[collect] %s\n' "$*" >&2; }
die()  { printf '[collect][FATAL] %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --
log "preflight"
for v in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_URL; do
  [[ -n "${!v:-}" ]] || die "missing env $v"
done
for b in psql curl jq rg supabase; do
  command -v "$b" >/dev/null || die "missing binary: $b"
done
[[ -d "$CODE_DIR" ]] || die "CODE_DIR not found: $CODE_DIR"

psql "$SUPABASE_DB_URL" -Atqc "select 1" >/dev/null 2>&1 \
  || die "cannot connect to SUPABASE_DB_URL"

api_status=$(curl -s -o "$RAW/api/project.json" -w '%{http_code}' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$API")
[[ "$api_status" == "200" ]] || die "Management API returned $api_status for project (token/permission?)"

{
  echo "{\"collected_at\":\"$(date -u +%FT%TZ)\","
  echo " \"collector_version\":\"1.0.0\","
  echo " \"supabase_cli\":\"$(supabase --version 2>/dev/null | head -1)\","
  echo " \"psql\":\"$(psql --version | head -1)\","
  echo " \"project_ref\":\"$SUPABASE_PROJECT_REF\","
  echo " \"code_dir\":\"$(cd "$CODE_DIR" && pwd)\"}"
} | jq . > "$RAW/preflight.json"

# ------------------------------------------------------------ 1. database ---
log "db: schema dump (schema-only)"
pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges \
  --schema=public --schema=storage --schema=auth > "$RAW/db/schema.sql" 2>"$RAW/db/pg_dump.err" \
  || log "pg_dump partial failure, see raw/db/pg_dump.err"

# 每個查詢輸出一個 JSON array；q <name> <sql>
q() {
  local name="$1" sql="$2"
  psql "$SUPABASE_DB_URL" -Atq -v ON_ERROR_STOP=1 \
    -c "select coalesce(json_agg(t), '[]'::json) from ($sql) t" \
    > "$RAW/db/$name.json" 2>"$RAW/db/$name.err" \
    || { log "query $name failed"; echo '[]' > "$RAW/db/$name.json"; }
}

log "db: introspection"
q tables "select table_schema, table_name from information_schema.tables
  where table_schema in ('public') and table_type='BASE TABLE' order by 1,2"

q rls_status "select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='public' order by 2"

q policies "select schemaname, tablename, policyname, cmd, roles::text, qual, with_check,
  (coalesce(qual,'')||coalesce(with_check,'')) ~* 'auth\.(uid|jwt|role)\(' as uses_auth_fn
  from pg_policies order by 1,2,3"

q extensions "select extname, extversion from pg_extension order by 1"

q realtime_tables "select schemaname, tablename from pg_publication_tables
  where pubname='supabase_realtime' order by 1,2"

q cron_jobs "select jobid, jobname, schedule, command, active from cron.job order by 1"

q db_webhooks "select t.tgname as trigger, c.relname as table, p.proname as function
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
  where not t.tgisinternal and p.proname in ('http_request') order by 2,1"

q functions "select n.nspname as schema, p.proname as name, l.lanname as language,
  p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' order by 2"

q triggers "select c.relname as table, t.tgname as trigger, p.proname as function
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname='public' order by 1,2"

q storage_buckets "select id, name, public, file_size_limit, allowed_mime_types,
  (select count(*) from storage.objects o where o.bucket_id=b.id) as object_count
  from storage.buckets b order by 1"

q auth_providers "select coalesce(provider,'(none)') as provider, count(*) as identities
  from auth.identities group by 1 order by 2 desc"

q auth_user_count "select count(*) as users from auth.users"

q vault_secret_names "select name, description from vault.secrets order by 1"

q role_grants "select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated','service_role')
  group by 1,2 order by 2,1"

q foreign_servers "select srvname, fdw.fdwname from pg_foreign_server s join pg_foreign_data_wrapper fdw on fdw.oid=s.srvfdw"

# ------------------------------------------------------- 2. project config ---
log "api: management api"
: > "$RAW/api/_status.tsv"
api_get() {  # api_get <name> <path> [jq_filter]
  local name="$1" path="$2" filter="${3:-.}"
  local code
  code=$(curl -s -o "$RAW/api/$name.raw.json" -w '%{http_code}' \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$API$path")
  printf '%s\t%s\t%s\n' "$name" "$path" "$code" >> "$RAW/api/_status.tsv"
  if [[ "$code" == "200" ]]; then
    jq "$filter" "$RAW/api/$name.raw.json" > "$RAW/api/$name.json"
  else
    echo 'null' > "$RAW/api/$name.json"
  fi
  rm -f "$RAW/api/$name.raw.json"
}

# 剔除任何看起來像 secret 的欄位
REDACT='walk(if type=="object" then with_entries(select(.key|test("secret|password|private|token|_key$";"i")|not)) else . end)'

api_get auth_config      "/config/auth"                "$REDACT"
api_get postgres_config  "/config/database/postgres"   "$REDACT"
api_get postgrest_config "/postgrest"                  "$REDACT"
api_get edge_functions   "/functions"                  "map({slug,name,status,verify_jwt,import_map,entrypoint_path,updated_at})"
api_get secret_names     "/secrets"                    "map({name})"
api_get network_restr    "/network-restrictions"       "$REDACT"
api_get custom_hostname  "/custom-hostname"            "$REDACT"
api_get ssl_enforcement  "/ssl-enforcement"            "."
api_get api_keys_meta    "/api-keys"                   "map({name,type:(.type//\"legacy\")})"

log "api: edge function sources"
if supabase functions list --project-ref "$SUPABASE_PROJECT_REF" >/dev/null 2>&1; then
  mkdir -p "$RAW/api/functions_src"
  for slug in $(jq -r '.[]?.slug // empty' "$RAW/api/edge_functions.json"); do
    supabase functions download "$slug" --project-ref "$SUPABASE_PROJECT_REF" \
      >/dev/null 2>>"$RAW/api/functions_download.err" && \
      { [[ -d "supabase/functions/$slug" ]] && cp -r "supabase/functions/$slug" "$RAW/api/functions_src/"; } || true
  done
fi

# ---------------------------------------------------------- 3. code scan -----
log "code: static scan"
scan() {  # scan <feature> <regex>  -> JSON lines {feature,file,line,match}
  rg --no-messages -n -o -e "$2" \
     -g '*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,dart,swift,kt}' \
     -g '!node_modules' -g '!dist' -g '!build' -g '!.next' "$CODE_DIR" 2>/dev/null \
  | awk -F: -v f="$1" '{ file=$1; line=$2; $1=""; $2=""; sub(/^::/,""); print f "\t" file "\t" line "\t" $0 }'
}
{
  scan postgrest_table  '\.from\((["'"'"'])[A-Za-z0-9_]+\1\)'
  scan postgrest_rpc    '\.rpc\((["'"'"'])[A-Za-z0-9_]+\1'
  scan postgrest_embed  '\.select\((["'"'"'`])[^)]*\([^)]*\)[^)]*\1\)'
  scan auth             '\.auth\.[A-Za-z]+\('
  scan auth_admin       '\.auth\.admin\.[A-Za-z]+\('
  scan storage          '\.storage\.(from|createBucket|listBuckets|getBucket)\('
  scan realtime         '\.channel\(|postgres_changes|\.on\((["'"'"'])broadcast|presence'
  scan edge_functions   'functions\.invoke\('
  scan service_role_key 'SERVICE_ROLE|service_role'
  scan supabase_url     'SUPABASE_URL|supabase\.co'
} | jq -R -s 'split("\n") | map(select(length>0) | split("\t") | {feature:.[0], file:.[1], line:(.[2]|tonumber), match:.[3]})' \
  > "$RAW/code/hits.json"

jq -r '.[] | select(.feature=="postgrest_table") | .match | capture("\\.from\\([\"'"'"'](?<t>[A-Za-z0-9_]+)").t' \
  "$RAW/code/hits.json" | sort -u | jq -R -s 'split("\n")|map(select(length>0))' > "$RAW/code/tables_referenced.json"

jq -r '.[] | select(.feature=="postgrest_rpc") | .match | capture("\\.rpc\\([\"'"'"'](?<f>[A-Za-z0-9_]+)").f' \
  "$RAW/code/hits.json" | sort -u | jq -R -s 'split("\n")|map(select(length>0))' > "$RAW/code/rpc_referenced.json"

# ------------------------------------------------------- 4. cross checks -----
log "checks"
jq -n \
  --slurpfile tables       "$RAW/db/tables.json" \
  --slurpfile rls          "$RAW/db/rls_status.json" \
  --slurpfile policies     "$RAW/db/policies.json" \
  --slurpfile dbfns        "$RAW/db/functions.json" \
  --slurpfile code_tables  "$RAW/code/tables_referenced.json" \
  --slurpfile code_rpc     "$RAW/code/rpc_referenced.json" \
  --slurpfile hits         "$RAW/code/hits.json" '
  ($tables[0]  | map(.table_name)) as $schema_tables |
  ($dbfns[0]   | map(.name))       as $schema_fns |
  ($rls[0]     | map(select(.rls_enabled==false) | .table)) as $rls_off |
  ($policies[0]| map(.tablename) | unique) as $tables_with_policy |
  {
    tables_in_code_not_in_schema: ($code_tables[0] - $schema_tables),
    tables_in_schema_not_in_code: ($schema_tables - $code_tables[0]),
    rpc_in_code_not_in_schema:    ($code_rpc[0] - $schema_fns),
    rls_disabled_tables:          $rls_off,
    rls_enabled_but_no_policy:    (($rls[0] | map(select(.rls_enabled)|.table)) - $tables_with_policy),
    policies_using_auth_fn:       ($policies[0] | map(select(.uses_auth_fn)) | length),
    service_role_key_in_client_code: ($hits[0] | map(select(.feature=="service_role_key")) | length > 0),
    realtime_used_in_code:        ($hits[0] | map(select(.feature=="realtime")) | length > 0),
    edge_functions_invoked_in_code: ($hits[0] | map(select(.feature=="edge_functions")) | length > 0)
  }' > "$RAW/checks.json"

# ------------------------------------------------------------ manifest -------
log "assemble manifest"
src_db()   { echo "{\"kind\":\"sql\",\"file\":\"raw/db/$1.json\"}"; }
src_api()  { echo "{\"kind\":\"management_api\",\"file\":\"raw/api/$1.json\"}"; }
src_code() { echo "{\"kind\":\"code_scan\",\"file\":\"raw/code/$1.json\"}"; }

jq -n \
  --slurpfile pre "$RAW/preflight.json" \
  --slurpfile checks "$RAW/checks.json" \
  --rawfile   api_status "$RAW/api/_status.tsv" \
  --slurpfile tables "$RAW/db/tables.json"         --argjson s_tables "$(src_db tables)" \
  --slurpfile rls "$RAW/db/rls_status.json"        --argjson s_rls "$(src_db rls_status)" \
  --slurpfile policies "$RAW/db/policies.json"     --argjson s_policies "$(src_db policies)" \
  --slurpfile ext "$RAW/db/extensions.json"        --argjson s_ext "$(src_db extensions)" \
  --slurpfile rt "$RAW/db/realtime_tables.json"    --argjson s_rt "$(src_db realtime_tables)" \
  --slurpfile cron "$RAW/db/cron_jobs.json"        --argjson s_cron "$(src_db cron_jobs)" \
  --slurpfile hooks "$RAW/db/db_webhooks.json"     --argjson s_hooks "$(src_db db_webhooks)" \
  --slurpfile fns "$RAW/db/functions.json"         --argjson s_fns "$(src_db functions)" \
  --slurpfile trg "$RAW/db/triggers.json"          --argjson s_trg "$(src_db triggers)" \
  --slurpfile buckets "$RAW/db/storage_buckets.json" --argjson s_buckets "$(src_db storage_buckets)" \
  --slurpfile prov "$RAW/db/auth_providers.json"   --argjson s_prov "$(src_db auth_providers)" \
  --slurpfile users "$RAW/db/auth_user_count.json" --argjson s_users "$(src_db auth_user_count)" \
  --slurpfile vault "$RAW/db/vault_secret_names.json" --argjson s_vault "$(src_db vault_secret_names)" \
  --slurpfile grants "$RAW/db/role_grants.json"    --argjson s_grants "$(src_db role_grants)" \
  --slurpfile fdw "$RAW/db/foreign_servers.json"   --argjson s_fdw "$(src_db foreign_servers)" \
  --slurpfile authcfg "$RAW/api/auth_config.json"  --argjson s_authcfg "$(src_api auth_config)" \
  --slurpfile pgcfg "$RAW/api/postgres_config.json" --argjson s_pgcfg "$(src_api postgres_config)" \
  --slurpfile rest "$RAW/api/postgrest_config.json" --argjson s_rest "$(src_api postgrest_config)" \
  --slurpfile edge "$RAW/api/edge_functions.json"  --argjson s_edge "$(src_api edge_functions)" \
  --slurpfile secrets "$RAW/api/secret_names.json" --argjson s_secrets "$(src_api secret_names)" \
  --slurpfile net "$RAW/api/network_restr.json"    --argjson s_net "$(src_api network_restr)" \
  --slurpfile host "$RAW/api/custom_hostname.json" --argjson s_host "$(src_api custom_hostname)" \
  --slurpfile hits "$RAW/code/hits.json"           --argjson s_hits "$(src_code hits)" '
  def item(v; s): {value: v, source: s};
  {
    meta: $pre[0],
    database: {
      tables:            item($tables[0];   $s_tables),
      rls_status:        item($rls[0];      $s_rls),
      policies:          item($policies[0]; $s_policies),
      extensions:        item($ext[0];      $s_ext),
      realtime_tables:   item($rt[0];       $s_rt),
      cron_jobs:         item($cron[0];     $s_cron),
      database_webhooks: item($hooks[0];    $s_hooks),
      functions:         item($fns[0];      $s_fns),
      triggers:          item($trg[0];      $s_trg),
      storage_buckets:   item($buckets[0];  $s_buckets),
      auth_providers:    item($prov[0];     $s_prov),
      auth_user_count:   item($users[0];    $s_users),
      vault_secret_names:item($vault[0];    $s_vault),
      role_grants:       item($grants[0];   $s_grants),
      foreign_servers:   item($fdw[0];      $s_fdw)
    },
    project_config: {
      auth:            item($authcfg[0]; $s_authcfg),
      postgres:        item($pgcfg[0];   $s_pgcfg),
      postgrest:       item($rest[0];    $s_rest),
      edge_functions:  item($edge[0];    $s_edge),
      secret_names:    item($secrets[0]; $s_secrets),
      network_restrictions: item($net[0]; $s_net),
      custom_hostname: item($host[0];    $s_host)
    },
    code_usage: {
      hits: item($hits[0]; $s_hits),
      features_used: ($hits[0] | map(.feature) | unique)
    },
    checks: $checks[0],
    errors: {
      management_api: ($api_status | split("\n") | map(select(length>0) | split("\t"))
                        | map(select(.[2] != "200")) | map({name:.[0], path:.[1], http_status:.[2]}))
    }
  }' > "$OUT_DIR/manifest.json"

log "done -> $OUT_DIR/manifest.json"
jq '{tables:(.database.tables.value|length), policies:(.database.policies.value|length),
     extensions:(.database.extensions.value|map(.extname)),
     edge_functions:(.project_config.edge_functions.value|if .==null then "n/a" else length end),
     features_used:.code_usage.features_used, api_errors:(.errors.management_api|length),
     checks:.checks}' "$OUT_DIR/manifest.json" >&2
