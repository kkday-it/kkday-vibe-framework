# AI 開發規則

這是一個 `vibe-project-template` 專案。你在修改或建立任何檔案之前，**必須**先閱讀 `docs/cloud-ready-spec.md`。這份 DevOps 上雲標準是所有架構決策的依歸。

<!-- ============================================================
     公司共用段(scaffold 生成,勿改。修訂走 vibe-project-template repo)
     ============================================================ -->

## 最高原則

- 本專案最終部署在公司內部 EKS。開發任何功能前，先讀 `docs/cloud-ready-spec.md`。
- 若本檔與 `docs/cloud-ready-spec.md` 衝突，以 `docs/cloud-ready-spec.md` 為準。
- 預設目標是 Docker + EKS + RDS PostgreSQL + S3 + Kubernetes CronJob + runtime env/secrets。

## Cloud-Ready 鐵則

- HTTP service 必須讀 `$PORT` 並綁 `0.0.0.0`。
- 必須提供無外部依賴的 `/health` 或 `/api/health`，不可查 DB、不可登入、不可打外部服務。
- 所有設定與 secret 只從 runtime env 來；新增 env 時同步更新 `.env.example`，並標註分類、用途、必填與否。
- 容器內不寫專案目錄；暫存只寫 `/tmp`，檔案產出走 `ctx.storage` / S3。
- DB 一律 PostgreSQL；SQLite / JSON file DB / file queue 只可用於 local prototype，不可進 cloud-ready path。
- schema 變更走 `db/migrations/NNNN_description.sql`；runtime 不做 DDL。
- log 寫 stdout/stderr；audit log、status page、notification 不能含 secret 或未遮罩 PII。

## 資料夾規約

1. **src/ 與 workflows/ 分離**：`src/` 放服務與專案內部邏輯；「有副作用、要被治理」的動作單元一律寫成 `workflows/` 下的 workflow 包。
2. **adapters/integrations 不寫業務邏輯**：只封裝平台差異與 vendor SDK。
3. **assets/ 與 docs/ 不進 src/**：AI 生成的圖、報告、截圖一律放 `assets/` 或 S3，不要散在 repo 根目錄。

## 憑證鐵則

- 程式碼與設定檔永遠只出現 `vault://` 引用或 env 變數名，絕不出現帳密/token/key 的值。
- `.env` 只存在本機，永不 commit。
- 不要在 Docker build 階段使用 secret；secret 只在 runtime 注入。

## 串接鐵則

- Slack/Gmail/Google/AWS 等外部服務經公司 connector 或 `ctx.*` adapter。
- workflow 內只認 `ctx.*`：`ctx.secrets`、`ctx.browser`、`ctx.notify`、`ctx.db`、`ctx.storage`、`ctx.sheet`、`ctx.mail`、`ctx.log`、`ctx.checkpoint`。
- 黃/紅區 workflow 禁止直接 import vendor SDK；vendor SDK 只能出現在 adapter。

## DB 鐵則

- 公司生產資料：讀用唯讀帳號與允許環境；寫禁直寫，走 API/正門或受治理 workflow。
- 專案自有 state：使用 PostgreSQL schema；連線資訊由 env/vault 注入。
- migration 只從已 merge 的 main 由 CI/平台執行；app runtime 不執行 DDL。

## 資料落點

| 資料 | Cloud-ready 落點 | 介面 |
|---|---|---|
| 執行狀態、結構化紀錄 | PostgreSQL | `ctx.db` |
| 檔案類產出：報表、憑證、截圖、PDF | S3 | `ctx.storage.put()` |
| 給人看/給 OP 用的表格 | Google Sheet/Drive 匯出視圖 | `ctx.sheet.export()` |
| 執行期 log | stdout/stderr + audit log | `ctx.log` |

Google Sheet/Drive 是匯出視圖，不是資料庫；壞了要能從 PostgreSQL/S3 重導。

## PII 與 Audit Log

- script 內部處理 PII 時可以用裸資料，例如填表、比對名單、送 API。
- 一旦寫入 `ctx.log`、status page、Slack/Email notification、run summary，必須遮罩 PII 與 secret。
- `PROJECT.yaml touches.pii: true` 時，狀態頁只放統計、筆數、錯誤類型、來源系統連結，不放客人明細。
- 需要追蹤特定人/訂單時，優先使用來源系統 record id、hash、末四碼或摘要，不記完整個資。

## 排程與執行鐵則

- 排程一律宣告在 `PROJECT.yaml schedules`，並實作對應 `POST /api/jobs/<name>` endpoint。
- Cloud 執行由 Kubernetes CronJob 呼叫 HTTP endpoint，帶 `Authorization: Bearer $CRON_SECRET`。
- 每個 job endpoint 必須冪等、可重跑、有界執行，回傳 JSON 摘要並寫 masked audit log。
- 禁止私有 cron、container 內 crond、APScheduler 常駐、`setInterval` 當排程、GitHub Actions cron 作為唯一排程。
- Dkron/vibefile/runner server 不是 cloud-ready 主線；若專案真的需要，先查 `docs/roadmap.md` 並標成 legacy/fallback。

## 觀測與錯誤鐵則

- 使用 `ctx.log.step("name")` 包住重要步驟；不要自己散落裸 `print` 或 `logging.basicConfig`。
- workflow 內不要吞錯。拋 typed error，讓框架做截圖、告警、狀態記錄與重跑判斷。
- 送出後狀態不明的寫入型錯誤不可自動 retry。
- error tracking DSN 走 env，沒設定時安靜停用。

## 支援的工具(ctx 能力速查表)

| 介面 | 用途 | 範例 |
|---|---|---|
| `ctx.secrets.get(ref)` | 取憑證(vault/env 引用) | `token = ctx.secrets.get("vault://proj/KEY")` |
| `ctx.browser` | 受管 headless browser | `page = ctx.browser.new_page()` |
| `ctx.notify(msg)` | 通知 team channel | `ctx.notify("3 筆完成")` |
| `ctx.db` | PostgreSQL 專案 schema | `ctx.db.execute(...)` |
| `ctx.storage.put(path)` | 上傳 S3 產出 | `url = ctx.storage.put("report.pdf")` |
| `ctx.sheet.export(rows, name)` | 匯出 Google Sheet 視圖 | `ctx.sheet.export(rows, "monthly")` |
| `ctx.mail.send(to, subj, body)` | 發信 | `ctx.mail.send(...)` |
| `ctx.log.step(name)` | masked structured audit log | `with ctx.log.step("login"): ...` |
| `ctx.checkpoint(preview)` | 紅區確認點 | `ctx.checkpoint(dry_run_result)` |

> 尚未實作的介面會拋 typed `NotYetImplemented`。不要繞過 `ctx.*` 直接 import vendor SDK；把缺口記到 framework roadmap。

<!-- ============================================================
     專案自訂段(以下由專案自行維護)
     ============================================================ -->

## 專案規則

(在此撰寫本專案的 domain 規則、名詞定義、特殊限制)
