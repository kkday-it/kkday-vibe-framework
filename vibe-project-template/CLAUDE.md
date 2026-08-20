# AI 開發規則

<!-- ============================================================
     公司共用段(scaffold 生成,勿改。修訂走 vibe-project-template repo)
     ============================================================ -->

## 資料夾規約(三條,其他自由)

1. **src/ 與 workflows/ 分離**:src/ 放專案內部邏輯;「有副作用、要被治理」的動作單元(打內部 API、操作外部網站、發訊息)一律寫成 workflows/ 下的 workflow 包(照 workflow-contract-v0:manifest.yaml + flow + README + tests/)。判斷法:這段程式碼掛掉或亂跑會不會影響別人/別的系統?會 → workflows/。
2. **integrations/ 不寫業務邏輯**:只放連線設定與 connector 引用。
3. **assets/ 與 docs/ 不進 src/**:AI 生成的圖、報告、截圖一律 assets/。

## 憑證鐵則

- 程式碼與設定檔**永遠只出現 `vault://` 引用或 env 變數名**,絕不出現帳密/token/key 的值。
- `.env` 只存在本機,永不 commit(.gitignore 已擋)。新增變數時同步更新 `.env.example`(只放 key 名與說明)。

## 串接鐵則

- Slack/Gmail 等外部服務**只准經 `kkday-connectors`**(src/ 內直接呼叫);禁止自申 bot/token、禁止直接使用 slack_sdk、google-api-python-client 等 SDK 拿 token。
- **workflows/ 內連 connectors 也不准直用**:workflow 只認 `ctx.*`(ctx.secrets / ctx.browser / ctx.notify / ctx.checkpoint),由 platform_sdk shim 在底下實作。

## DB 鐵則

- 公司生產資料:讀 → 唯讀帳號走 replica/SIT;寫 → 禁直寫,一律走 API 或包成 workflow。
- 專案自有 state:用 vibe DB(每專案一個 schema,連線 vault 注入,分 sit/stage/prod);DB 檔(*.db/*.sqlite*)不進 git。
- migration 只准從已 merge 的 main 跑;優先用啟動時 ensure(`ADD COLUMN IF NOT EXISTS`)。

## 資料落點三層(想「存哪裡」時照這張表,不要發明第四種)

| 資料 | 落點 | 介面 |
|---|---|---|
| 執行狀態、結構化紀錄(source of truth) | vibe DB(專案 schema) | `ctx.db` |
| 檔案類產出:報表、憑證、截圖 | S3 | `ctx.storage.put()` |
| 給人看/給 OP 用的表格 | Google Sheet/Drive(Shared Drive,單向匯出視圖,**不是資料庫**) | `ctx.sheet.export()` |

- Google 一律走共用 service account + 專案的 Shared Drive 資料夾;禁個人 OAuth、禁 domain-wide delegation。
- 拿檔防呆:Drive/Sheet 找檔一律用 file ID 或專案資料夾內固定路徑,**禁檔名模糊搜尋**;workflow 吃外部輸入檔前必驗 schema(欄位/筆數/日期合理性),不對就拋 typed error,不要帶著錯資料往下跑。

## 排程與執行鐵則

- 排程一律宣告在 PROJECT.yaml `schedules`(task→cron),由 deploy 同步到 Dkron;**禁止私有 cron**(筆電 crontab、自開 EC2 cron)。不用 GitHub Actions cron(會延遲)。
- 每個排程 task 必須:冪等可重跑、跑掛 Slack 通知、執行結束發 vibefile 狀態頁。
- 統一進入點是 `./run.sh <task>`;新增排程任務=在 run.sh 加 case + PROJECT.yaml 加一條 schedules。

## 觀測與 log 鐵則

- log 一律經 `ctx.log`(結構化 JSONL:ts/run_id/workflow/step/level/msg/data),步驟用 `with ctx.log.step("login"):` 包 — 不要自己 print/logging.basicConfig。log 執行中寫本機、結束由框架上傳 S3;vibe DB 只存 run 摘要。
- 排程任務與長批次必產狀態頁(HTML → vibefile,`folder=專案id`、`filename=<run_id>.html`)— 由框架 run wrapper 自動處理,workflow 內不用寫。
- 失敗三件套由框架自動做(截圖+最後 HTML 進 S3、Slack 告警、狀態頁重跑指引),**workflow 內不要自己 try/except 吞錯** — 拋 typed error 讓框架接手。不自動 retry;送單後狀態不明絕不重試。
- 狀態頁上**絕不放憑證/token;pii: true 的專案只放統計不放明細**(vibefile 無 per-project 授權,全公司登入者可見)。

## 支援的工具(ctx 能力速查表 — 隨 kkday-connectors 版本更新)

| 介面 | 用途 | 範例 |
|---|---|---|
| `ctx.secrets.get(ref)` | 取憑證(vault 引用) | `token = ctx.secrets.get("vault://proj/KEY")` |
| `ctx.browser` | 受管 headless 瀏覽器(Playwright) | `page = ctx.browser.new_page()` |
| `ctx.notify(msg)` | Slack 通知(team channel) | `ctx.notify("3 筆完成")` |
| `ctx.db` | vibe DB(專案 schema) | `ctx.db.execute(...)` |
| `ctx.storage.put(path)` | 上傳 S3 產出,回連結 | `url = ctx.storage.put("report.pdf")` |
| `ctx.sheet.export(rows, name)` | 匯出 Google Sheet 視圖 | `ctx.sheet.export(rows, "monthly")` |
| `ctx.mail.send(to, subj, body)` | 發信(SA+白名單寄件人) | `ctx.mail.send(...)` |
| `ctx.log.step(name)` | 結構化 log 步驟 | `with ctx.log.step("login"): ...` |
| `ctx.checkpoint(preview)` | 確認點(紅區必用) | `ctx.checkpoint(dry_run_result)` |

> 尚未實作的介面(ctx.db/storage/sheet/mail/log)呼叫時會拋 NotImplementedError — 介面先凍結,實作隨 kkday-connectors 補齊;workflow 程式碼照寫,不要繞去自己 import 別的套件。

<!-- ============================================================
     專案自訂段(以下由專案自行維護)
     ============================================================ -->

## 專案規則

(在此撰寫本專案的 domain 規則、名詞定義、特殊限制)
