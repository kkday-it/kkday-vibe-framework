# manifest.json 結構

每個資料節點都是 `{ "value": <data>, "source": { "kind", "file" } }`。`source.file` 是相對 `OUT_DIR` 的路徑，指向產生該值的原始輸出。沒有 source 的值不應存在於 manifest。

## meta
preflight 資訊：採集時間、collector 版本、CLI/psql 版本、project ref、code dir。

## database（source.kind = "sql"）

| 欄位 | 查詢來源 | 說明 |
|---|---|---|
| tables | information_schema.tables (public) | 業務表清單 |
| rls_status | pg_class.relrowsecurity | 每張表 RLS 開關 |
| policies | pg_policies | 含 `uses_auth_fn`（qual/with_check 是否用到 auth.uid/jwt/role） |
| extensions | pg_extension | pg_cron、pg_net、pgvector、wrappers、vault 等各自代表一個遷移項 |
| realtime_tables | pg_publication_tables (supabase_realtime) | 開了 Realtime 的表 |
| cron_jobs | cron.job | 需 pg_cron，否則為 [] |
| database_webhooks | pg_trigger → supabase_functions.http_request | Database Webhooks 的實作 |
| functions | pg_proc (public) | 含 language、security_definer |
| triggers | pg_trigger (public) | |
| storage_buckets | storage.buckets + objects count | public/private、size limit、mime |
| auth_providers | auth.identities group by provider | 實際被使用的登入方式 |
| auth_user_count | auth.users | |
| vault_secret_names | vault.secrets | 只有名稱 |
| role_grants | information_schema.role_table_grants | anon / authenticated / service_role 權限 |
| foreign_servers | pg_foreign_server | wrappers / FDW |

## project_config（source.kind = "management_api"）

| 欄位 | endpoint | 說明 |
|---|---|---|
| auth | /config/auth | providers、redirect URLs、JWT、MFA、hooks；secret 類欄位已剔除 |
| postgres | /config/database/postgres | |
| postgrest | /postgrest | exposed schemas、max rows |
| edge_functions | /functions | slug、verify_jwt、entrypoint |
| secret_names | /secrets | 只有名稱 |
| network_restrictions | /network-restrictions | |
| custom_hostname | /custom-hostname | |

endpoint 回非 200 時該欄位 value 為 `null`，狀態記在 `errors.management_api`。

## code_usage（source.kind = "code_scan"）
- `hits`: 每筆 `{feature, file, line, match}`
- `features_used`: hits 的 feature 去重

## checks
腳本計算的交叉核對，見 SKILL.md 第 4 節。

## errors
- `management_api`: `[{name, path, http_status}]`，所有非 200 的 endpoint。
