# Management API 使用清單與排查

Base: `https://api.supabase.com/v1/projects/{ref}`
Auth: `Authorization: Bearer <personal access token>`

| name | path | 備註 |
|---|---|---|
| project | `` (root) | preflight 用，非 200 直接中止 |
| auth_config | /config/auth | 需 Owner/Admin |
| postgres_config | /config/database/postgres | |
| postgrest_config | /postgrest | |
| edge_functions | /functions | |
| secret_names | /secrets | 回傳含值，腳本只保留 name |
| network_restr | /network-restrictions | |
| custom_hostname | /custom-hostname | 未設定時可能回 404，屬正常 |
| ssl_enforcement | /ssl-enforcement | |
| api_keys_meta | /api-keys | 只保留 name/type |

## 狀態碼判讀

- **401**：token 無效或過期。
- **403**：使用者在該 org 的角色權限不足（常見於 Developer 角色）。請使用者找 Owner 跑，或接受該欄位缺漏。
- **404**：(a) 該功能未啟用（custom_hostname）；(b) endpoint 路徑已變更。Supabase 的 Management API 路徑約每半年會調整，若多個 endpoint 同時 404，對照官方 API reference（supabase.com/docs/reference/api）更新 `scripts/collect_supabase.sh` 中 `api_get` 的路徑，並回報 skill 維護者。
- **429**：rate limit，稍後重跑即可，腳本無 retry。

## 已知限制
- Auth hooks、SMTP 設定在 `/config/auth` 內，但密碼類欄位被 REDACT filter 剔除；若需驗證 SMTP 是否有設，看 `smtp_host` 等非敏感欄位。
- Log/analytics endpoint 未納入（需另外授權且量大）。若要看「實際被打過的 endpoint」，請使用者從 Dashboard Logs 匯出，另行處理。
