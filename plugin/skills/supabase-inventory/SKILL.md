---
name: supabase-inventory
description: 盤點一個 Supabase 專案實際用到的功能、設定與 schema，產出附來源的 manifest.json，作為搬遷到 EKS / Internal Cloud 的依據。只要使用者提到「Supabase 專案要搬」、「盤點 Supabase 用了什麼」、「vibe coding 的 app 要上 EKS」、「匯出 Supabase schema / 設定 / RLS / edge functions」、「Supabase migration assessment」，或給出 Supabase project ref、supabase.co URL 並想了解專案結構，就使用這個 skill——即使他們沒說「盤點」兩個字。不要自己用 psql 或讀 code 去猜功能，一律跑本 skill 的採集腳本。
compatibility: 需要 bash、psql、pg_dump、curl、jq、rg（ripgrep）、supabase CLI。需要 Supabase personal access token 與 DB 連線字串。
---
> 本 skill 唯一源在 `kkday-it/kkday-vibe-framework` 的 vibe-governance plugin;個人 ~/.claude/skills 下的散裝副本應移除。


# Supabase Inventory

把一個 Supabase 專案「用了什麼」變成一份可驗證的 manifest。輸入是 project ref + token + DB URL + 程式碼目錄，輸出是 `manifest.json`，每個欄位都帶 `source` 指向原始查詢輸出。

## 為什麼要這樣做

vibe-coded app 靠 Supabase 省掉了 auth、storage、REST API、realtime、cron 等一大塊 backend，這些東西不在程式碼裡，在 Supabase 的系統 schema 與專案設定裡。搬到 EKS 時最容易漏的就是這些。

盤點結果會拿去做遷移決策（自架全套 Supabase vs 拆解重寫），所以**不能有任何一項是推測出來的**。你的角色是 orchestrator：跑腳本、看錯誤、解釋結果。分析與判斷交給腳本與下游的 vibe_assistant。

## 工作流程

### 1. 收集輸入

向使用者確認四件事，缺一不跑：

| 變數 | 說明 | 怎麼拿 |
|---|---|---|
| `SUPABASE_PROJECT_REF` | 專案 ref，20 碼小寫字母 | Dashboard URL `supabase.com/dashboard/project/<ref>` |
| `SUPABASE_ACCESS_TOKEN` | Personal access token，`sbp_` 開頭 | Dashboard → Account → Access Tokens |
| `SUPABASE_DB_URL` | Postgres 連線字串 | Dashboard → Connect → Session pooler；使用者需自己填 DB 密碥 |
| `CODE_DIR` | 要掃的程式碼根目錄 | 使用者指定，預設當前目錄 |

不要替使用者猜 token 或密碼，也不要把它們寫進任何檔案；只以環境變數傳給腳本。若使用者的 Supabase 角色不是 Owner，Management API 部分 endpoint 會 403，這是正常的，會被記錄而非中止。

### 2. 執行採集腳本

```bash
export SUPABASE_PROJECT_REF=...
export SUPABASE_ACCESS_TOKEN=...
export SUPABASE_DB_URL='postgresql://...'
CODE_DIR=<repo> OUT_DIR=./supabase-inventory bash <skill-path>/scripts/collect_supabase.sh
```

腳本行為：
- preflight 檢查 binary、env、DB 連線、API token；任一失敗直接中止。**不要**在 preflight 失敗後改用手動查詢繼續，把錯誤原封不動回報給使用者。
- 只讀。`pg_dump --schema-only`，不碰資料；secrets 只留名稱。
- 完成後 stderr 會印出摘要 JSON。

腳本在 cwd 可能會產生 `supabase/functions/`（下載 edge function 原始碼的副作用），跑完提醒使用者或在 temp dir 執行。

### 3. 檢查採集完整性

跑完先看三個地方，再談內容：

1. `raw/api/_status.tsv` — 非 200 的 endpoint。404 多半是 Management API 路徑變了（見 `references/management-api.md`），403 是權限。列給使用者，不要略過。
2. `raw/db/*.err` — 非空的表示該查詢失敗。`cron_jobs`、`vault_secret_names` 在未啟用對應 extension 時失敗是預期的；其他失敗要報。
3. `manifest.json` 的 `checks` 區塊 — 交叉核對結果，見下節。

### 4. 解讀 checks

`checks` 是腳本算出來的，不是你推理的。逐項向使用者說明含義：

| check | 意義 | 遷移影響 |
|---|---|---|
| `tables_in_code_not_in_schema` | code 引用了 schema 沒有的表 | 可能是死碼、動態 table name、或掃描漏抓 |
| `tables_in_schema_not_in_code` | 有表但 code 沒直接用 | 可能靠 RPC / trigger / 外部工具寫入，需人工確認 |
| `rpc_in_code_not_in_schema` | 呼叫了不存在的 function | 同上 |
| `rls_disabled_tables` | 沒開 RLS 的表 | 目前靠 anon key 全開，搬遷時要補 authz |
| `rls_enabled_but_no_policy` | 開了 RLS 但無 policy | 等同鎖死，只有 service_role 能讀，確認是否刻意 |
| `policies_using_auth_fn` | policy 依賴 `auth.uid()` 等 | 離開 GoTrue 後這些函式要重做 |
| `service_role_key_in_client_code` | 前端出現 service_role | 安全問題，與遷移無關但必須標出 |
| `realtime_used_in_code` / `edge_functions_invoked_in_code` | 用了 Realtime / Edge Functions | 各是一個獨立要自架或重寫的元件 |

### 5. 輸出

回覆使用者時：
- 先給採集狀態（成功/部分/失敗，哪些 endpoint 沒拿到）。
- 再給功能清單：只列 manifest 裡有 `source` 的項目，用 `code_usage.features_used` + `database.extensions` + `project_config.edge_functions` 組成。
- 再給 checks 中非空的項目。
- **不要**在這個 skill 裡做「該自架還是重寫」的決策，那是 vibe_assistant 的事。把 `manifest.json` 路徑交出去即可。

引用任何數字或名稱時，附上它來自 manifest 的哪個欄位。若使用者問的東西 manifest 沒有，就說沒採到，不要補。

### 6.（選）產「可轉傳的完成報告」+ egress 清單

`manifest.json` 是給 RD/AI 的技術檔。若主導者是非工程 PM、或要讓進度「看得見、可轉傳」，多產一份**去個資的 HTML 完成報告**（只含狀態+結構摘要+數字，**禁**個資/憑證/資料列/webhook/key）。遷移還需要一份 **egress host 清單**（每支 edge function 打的外部網址 + 頻率），給平台開白名單——這條容易漏、漏了上雲那條線就不通。作法見 `references/completion-report.md`。

## 檔案

- `scripts/collect_supabase.sh` — 採集腳本，唯一的資料來源。
- `references/manifest-schema.md` — manifest 結構與每個欄位對應的查詢，要向使用者解釋某欄位怎麼來的時候讀。
- `references/management-api.md` — 使用的 Management API endpoint 清單與失敗排查，`_status.tsv` 有非 200 時讀。
- `references/code-scan-patterns.md` — 程式碼掃描的 regex 與已知盲點，`tables_in_code_not_in_schema` 異常或使用者用非 supabase-js 方式呼叫時讀。
