# 程式碼掃描 patterns 與盲點

工具：ripgrep，副檔名 ts/tsx/js/jsx/mjs/cjs/vue/svelte/py/dart/swift/kt，排除 node_modules/dist/build/.next。

| feature | regex 意圖 |
|---|---|
| postgrest_table | `.from('<table>')` |
| postgrest_rpc | `.rpc('<fn>'` |
| postgrest_embed | `.select('a, b(*)')` 內含括號 → 使用了 PostgREST resource embedding |
| auth | `.auth.<method>(` |
| auth_admin | `.auth.admin.<method>(` → 用到 service_role |
| storage | `.storage.from(` / bucket 操作 |
| realtime | `.channel(` / `postgres_changes` / broadcast / presence |
| edge_functions | `functions.invoke(` |
| service_role_key | 字串 SERVICE_ROLE / service_role 出現 |
| supabase_url | SUPABASE_URL / supabase.co |

## 已知盲點（會造成 checks 誤判）

1. **動態 table name**：`.from(tableVar)` 不會被抓到 → `tables_in_schema_not_in_code` 偏多。
2. **直接打 REST**：`fetch('/rest/v1/orders')`、`/auth/v1/token`、`/storage/v1/object` 沒有 pattern。若使用者的 app 不用 supabase-js，加：
   - `rest/v1/[A-Za-z0-9_]+`
   - `auth/v1/`
   - `storage/v1/`
   - `realtime/v1/`
3. **Server-side SDK**（supabase-py 用 `.table()` 而非 `.from()`）：加 `\.table\((["'])[A-Za-z0-9_]+\1\)`。
4. **ORM 直連 Postgres**（Prisma / Drizzle）：完全繞過 PostgREST，schema 由 ORM 管；此時 `code_usage` 幾乎為空是正常的，改看 `prisma/schema.prisma` 或 drizzle schema。
5. **Edge Function 內部呼叫**：下載的 function 原始碼放在 `raw/api/functions_src/`，不在 CODE_DIR 內，不會被掃。需要時把該目錄加進第二次掃描。

修改 pattern 時改 `scripts/collect_supabase.sh` 的 `scan` 區塊，一行一個 feature。
