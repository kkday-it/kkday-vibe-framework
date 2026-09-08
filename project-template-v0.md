# Enterprise Workflows 框架 v0.2 — Cloud-Ready Repo Template

> **v0.2 決策**：本提案以 `vibe-cloud-ready-spec-0908.md` 為最高指導原則。任何 repo template、workflow contract、SDK shim、排程、DB、檔案儲存、log 或部署流程，若與 DevOps spec 衝突，一律以 DevOps spec 為準。
>
> 目標環境：Docker image → 內部 registry → GitOps/ArgoCD → AWS EKS；DB 是 RDS PostgreSQL；檔案是 S3；排程是 Kubernetes CronJob 呼叫 HTTP endpoint；secret/config 由平台 runtime env 注入。
>
> 本文件是「repo 層最小治理」。完整平台能力仍在 roadmap，不把未實作能力寫成已交付承諾。

---

## 1. 一句話

一個 **GitHub template repo + cloud-ready guard**：開新專案就長出標準結構、`PROJECT.yaml`、AI 開發規則、DevOps 上雲規約、憑證規約、audit log masking 與 CI 守門。治理要靠機器預設，而不是靠每位員工記得。

## 2. 設計原則

1. **DevOps spec first**：EKS/RDS/S3/Kubernetes CronJob 是主線；Dkron、vibefile、runner server 等若需要，放在 roadmap/legacy adapter，不是預設路徑。
2. **Cloud-ready by default**：template 必須引導 AI 產出 stateless、runtime env、HTTP job endpoint、health endpoint、PostgreSQL migration。
3. **治理資訊機器可讀**：專案級資訊進 `PROJECT.yaml`，workflow 級資訊進 `workflows/<name>/manifest.yaml`。
4. **副作用走 adapter**：workflow 只透過 `ctx.*` 碰外界。底層可從 local shim 換成正式 connector，但 workflow 程式不重寫。
5. **裸資料只留在執行記憶體**：script 處理 PII 時可使用原始值；一旦寫入 audit log、status page、notification、run summary，必須 mask。
6. **未實作但重要的東西不刪掉**：移到 `docs/roadmap.md`，標明觸發條件與 owner，避免被遺忘也避免誤導為已完成。

## 3. 標準 repo 結構

```text
my-vibe-project/
├── PROJECT.yaml
├── README.md
├── CLAUDE.md
├── Dockerfile
├── .dockerignore
├── compose.yml
├── .env.example
├── docs/
│   └── cloud-ready-spec.md
├── src/
│   ├── app.py 或 server.ts
│   └── adapters/
├── workflows/
│   └── <workflow-name>/
│       ├── manifest.yaml
│       ├── flow.py 或 flow.ts
│       ├── README.md
│       └── tests/
│           └── dry_run_case.yaml
├── db/
│   └── migrations/
│       └── 0001_baseline.sql
├── assets/
├── docs/
├── tests/
└── scripts/
    └── guard/
```

必要規則：

- `docs/cloud-ready-spec.md` 必須存在，`CLAUDE.md` 必須要求 AI 在動手前讀它。
- 專案必須在 `PROJECT.yaml` 宣告形狀 `shape: web | job`（cloud-ready spec §1.1）：web = 常駐 service；job = 批次作業，跑完就結束。
- 專案必須通過「第一關」：本機 `docker compose` 起得來、參數全在 `.env`（cloud-ready spec §1.8 驗收清單），repo 根目錄須有 `compose.yml`。
- `shape: web` 必須有無外部依賴的 `/health`；排程任務暴露 `POST /api/jobs/<name>`，驗 `Authorization: Bearer $CRON_SECRET`。
- `shape: job` 不需要 HTTP server 與 `/health`：CronJob 直接跑映像、`args` 傳工作名（對應 `./run.sh <task>`），失敗不自動重跑（`backoffLimit: 0`）、非零結束並發通知。
- 有 DB 就使用 PostgreSQL migration；runtime 路徑不可做 DDL。
- `src/` 放服務與業務邏輯；`workflows/` 放有副作用、需治理的動作單元；`adapters/` 封裝平台差異。

## 4. PROJECT.yaml — 專案身分證

```yaml
id: qa.booking-smoke
owner: lance.chien
team: qa
status: active
risk_tier: yellow
shape: web            # web | job(cloud-ready spec §1.1);job = 批次作業,CronJob 直接跑映像,不需 HTTP server

touches:
  internal_apis: [product-service, order-service]
  external_sites: [thsr.com.tw]
  integrations: [slack, gmail]
  databases: [rds/qa-booking]
  pii: true
  google_scope: []   # 用到 ctx.sheet/ctx.storage(Google)時填,adapter 只准碰這份清單內的 folder/sheet ID(conformance-gate-spec.md C4(a))

escalation: "#qa-booking-oncall"   # external_sites 非空,E1 強制必填

runtime:
  port: 8080
  health_endpoint: /health
  job_endpoint_prefix: /api/jobs

schedules:                          # task→cron map;task 名即排程單位
  daily_report: "0 2 * * 1-5"       # web 型:CronJob 打 POST /api/jobs/daily_report;job 型:跑映像 args=daily_report(./run.sh daily_report)
  healthcheck_thsr: "*/15 * * * *"  # external_sites 非空,E2 強制至少一個 healthcheck* task
```

說明：

- 綠區專案最低要求：`PROJECT.yaml` + secret scan + cloud-ready guard。
- `touches.pii: true` 強制 `risk_tier` 至少 yellow，且 audit/status/notification 必須套用 masking。
- `schedules` 是 repo 內的 `task→cron` map 宣告；實際執行由平台/GitOps 轉成 Kubernetes CronJob——web 型打 `POST /api/jobs/<task>`、job 型直接跑映像帶 `args`。不在 container 內跑 crond，也不用 in-process timer。endpoint 由慣例導出、timezone 與資源上限屬部署決定，都不寫在 `schedules` 裡（k8s manifest 由人維護在 GitOps repo，cloud-ready spec §5）。
- `touches.external_sites` 非空時，`escalation` 必填、`schedules` 須至少一個 `healthcheck*` task（`conformance-gate-spec.md` E1/E2，agent flow 專案適用）；`risk_tier: red` 也強制 `escalation`。

## 5. Workflow Contract 摘要

每個 workflow 目錄包含：

```text
workflows/<workflow-name>/
├── manifest.yaml
├── flow.py
├── README.md
└── tests/
    └── dry_run_case.yaml
```

manifest 至少要宣告：

- `id`、`owner`、`type`、`intent`、`risk_tier`
- `inputs` / `outputs`
- `credentials`，只准 `vault://` 或平台 secret ref，不准出現值
- `targets` / `egress` / 外部 host 清單
- `pii` 欄位或 `pii: true`
- 紅區 workflow 的確認點與 dry-run/preview 行為

flow 規則：

- 只透過 `ctx.secrets`、`ctx.browser`、`ctx.storage`、`ctx.db`、`ctx.notify`、`ctx.log` 等 adapter 碰外界。
- 不直接 import Slack/Gmail/Google/AWS vendor SDK；vendor SDK 只出現在 adapter。
- 不吞錯；拋 typed error 讓框架做告警、截圖、狀態記錄。
- 寫入型動作要集中、冪等、有 dry-run 或 preview。
- 可處理裸 PII，但不可把裸 PII 寫進 audit log/status/notification。

## 6. 設定與 Secret 規約

`.env.example` 必須逐項標註：

- `build-time public`
- `runtime secret`
- `runtime plain`
- 是否必填
- 用途

範例：

```dotenv
# runtime plain, required: HTTP service port. EKS injects PORT; local default is 8080.
PORT=8080

# runtime secret, required for scheduled endpoints.
CRON_SECRET=

# runtime plain, required when storage is enabled.
S3_BUCKET=
AWS_REGION=ap-northeast-1

# runtime secret/plain: DB connection. DATABASE_URL may be used locally.
DB_HOST=
DB_PORT=5432
DB_USER=
DB_PASSWORD=
DB_NAME=
DATABASE_URL=
```

程式啟動時缺必要 env 必須 fail fast，錯誤訊息列出缺哪些 key；不要 fallback 到 production/staging/local 這種猜測。

## 7. DB 規約

DevOps cloud profile 下：

- DB 一律是外部 PostgreSQL。SQLite / JSON file DB / file queue 只可作為 local prototype，不可進 cloud-ready path。
- app runtime 帳號只有 CRUD 權限，不執行 `CREATE` / `ALTER` / `DROP`。
- schema 變更放 `db/migrations/NNNN_description.sql`，forward-only、additive、已套用後不修改。
- migration runner 由 CI 或平台部署流程執行，從 env 讀連線、取 advisory lock、記錄 `schema_migrations`，可重複執行。
- DB 存 UTC；任何業務時區顯式指定。

## 8. 檔案與 Storage

- 使用者上傳、報表、截圖、PDF、匯出檔，cloud profile 一律進 S3。
- 程式內不可讀寫 AWS access key；S3 用 AWS SDK default credential chain。
- 本機暫存只用 `/tmp`，用完刪除，且不能假設下一個 request 還存在。
- Google Sheet/Drive 只能作為給人看的匯出視圖，不是 source of truth；source of truth 是 PostgreSQL/S3。

**拿錯檔案三重防呆**（Sheet/Drive adapter 適用；guard/測試落點見 `conformance-gate-spec.md` C4）：

1. **跨專案越權**：Google 存取憑證由平台/adapter 層代管，workflow 不得自己 import vendor SDK 直連。**adapter 介面接受任意 `file_id`/`path`（不然資料夾內動態新增的檔案讀不到），但執行期會查該 ID 的 parent chain，確認它是 `PROJECT.yaml touches.google_scope`（§4 schema）內某個 folder/sheet 的子孫，不在範圍內拋 `PermissionError`**——不是靜態白名單比對，是收斂進單一 adapter 實作的執行期邊界檢查，不是要求每個 workflow 自律；同一組憑證不因專案不同而能互相碰到彼此的資料夾。詳細設計（含防 API rate-limit 的快取要求）見 `conformance-gate-spec.md` C4(a)。
2. **同名檔案誤讀**：**adapter 介面只提供 `get(file_id)` / `get(path)`，不提供 `search(name_contains=...)` 這類模糊比對方法**——同名檔、舊版本並存時「搜尋結果不可預期」這個問題從介面設計上直接排除，不用逐一 review workflow 程式碼。
3. **來源資料本身錯誤**：adapter 邊界防不了人放錯檔案。workflow 讀入外部檔案後必須先驗 schema（欄位、筆數、日期範圍等合理性），不通過就丟 typed error 中止，不得帶著未驗證資料繼續執行；紅區 workflow 另需 dry-run/preview 讓人確認後再放行（見 §10 多方參數與紅區確認，或 §5 flow 規則的 dry-run/preview 要求）。**此條目前無自動化檢查**（同 conformance-gate-spec.md C4(c) 的誠實標註），只靠 CLAUDE.md 規範與 code review 把關。

## 9. 排程規約

主線依 `shape` 分兩型（cloud-ready spec §1.1/§4.7）：

- **`shape: web`**：Kubernetes CronJob → HTTP endpoint。服務內提供 `POST /api/jobs/<name>`，驗 `Authorization: Bearer $CRON_SECRET`（常數時間比對）。
- **`shape: job`**：Kubernetes CronJob 直接跑映像，`args` 傳工作名（容器 ENTRYPOINT 即工作分派器，對應 `./run.sh <task>`）。不需 HTTP endpoint 與 `/health`。CronJob 用 `args:` 不用 `command:`（`command` 會蓋掉 tini，SIGTERM 沒人收）；幾支工作靠檔案交棒的要當成一個 CronJob，不拆。失敗不自動重跑（`backoffLimit: 0`），非零結束並發通知。

兩型共通，每個排程任務必須：

1. 在 `PROJECT.yaml schedules` 以 `task→cron` map 宣告。endpoint 由慣例導出（web 型 `POST /api/jobs/<task>`、job 型 `./run.sh <task>`）；timezone、資源上限、單次時限屬部署決定，由 GitOps repo 的 k8s manifest 管（cloud-ready spec §5），不寫在 `schedules`。
2. 冪等、可重跑、有界執行。單次建議處理一批，回 JSON 摘要；最實用的冪等做法是留一份「今天這件事做過了沒」的台帳（DB 一張表）。
3. log 處理數、失敗數、run_id；log 內 PII/secret 必須 mask。
4. 失敗要有人知道：無人環境跑失敗只寫 log 等於沒發生 → 非零結束並發通知。
5. README 寫清楚排程頻率、可接受執行時段、外部 host、需要 env。

禁止：

- container 內跑 crond/APScheduler 常駐。
- `setInterval` / background thread 當排程。
- GitHub Actions cron 作為唯一排程。
- Dkron 作為 cloud-ready 主路徑。

Dkron 如仍需支援，定位為 legacy adapter 或特殊環境 fallback，列入 roadmap，不寫進預設 template。

## 10. 多方參數與紅區確認

真實紅區常見形狀不是「一人發起、一人 approve」而已，而是多角色補參數：

```text
draft(OP 填) → pending_cs(CS 補) → ready → run
```

cloud-ready 版落地原則：

- 狀態存在 PostgreSQL。
- 觸發/補參數介面部署在 EKS 內部 service，或由我方排程去拉外部表單資料；不依賴外部 SaaS webhook 主動打進內網。
- 每段 input 可標 `decided_by: <role>`；補參數本身就是 approval。
- audit log 記錄誰在何時補了哪段欄位，但欄位值若是 PII 必須 mask 或只留 hash/摘要。
- 執行 endpoint 只撿 `ready` 且已授權的 run。
- 紅區失敗不自動重試「送出後狀態不明」。

## 11. Observability 與 Audit Log

最低要求：

- app log 寫 stdout/stderr，一個事件一行，建議 JSON。
- health endpoint 不查 DB、不查外部服務。
- error tracking DSN 走 env，未設定時安靜停用。
- audit log 可保存 run_id、workflow、step、level、message、duration、result summary。
- audit log/status page/Slack notification 中不得出現 raw secret 或 raw PII。

PII masking 原則：

- script 內部處理表單、訂單、名單時可使用裸資料。
- 寫入 `ctx.log`、status renderer、notification、run summary 前必須 mask。
- manifest 或 `PROJECT.yaml touches.pii: true` 時，狀態頁只放統計、筆數、錯誤類型與來源系統連結，不放明細。
- 若業務需要可追蹤特定個資，使用 hash、末四碼或來源系統 record id，不在 audit log 存完整值。

## 12. Guard CI

模板預帶 guard，目標是把 DevOps spec 轉成機器檢查：

- secret scan。
- `PROJECT.yaml` schema 驗證。
- workflow manifest 驗證。
- 禁用直接 vendor SDK 檢查。
- cloud-ready 檢查：
  - `shape` 宣告存在且為 `web|job`；repo 名全小寫 kebab-case（registry 拒大寫）。
  - `.env.example` 變數有分類與用途。
  - 存在 `Dockerfile`、`.dockerignore`、`compose.yml`；web 型另須 `/health`。
  - 排程宣告：web 型必須有 HTTP job endpoint；job 型必須有 `run.sh` 工作分派器。
  - 掃描 `localhost`、`127.0.0.1`、SQLite、file DB、`setInterval`、`crond`、runtime DDL、寫專案目錄 uploads。
  - 檢查 Dockerfile 不 copy `.env`，且用非 root user。

目前 guard 只完成基本版；cloud-ready rules 的完整實作列入 roadmap。

## 13. 控制權歸屬

原則：**owner 控宣告，平台控機制**。

| 面向 | Owner 控 | 平台/框架控 |
|---|---|---|
| 排程 | `PROJECT.yaml schedules` 的 task 名與頻率、啟停 PR | Kubernetes CronJob/GitOps 轉換（含 timezone/資源上限）、執行、告警 |
| 憑證 | 宣告需要哪些 secret ref | secret 值、注入、輪替 |
| DB | schema/migration PR | RDS、備份、連線注入、migration 執行權限 |
| 檔案 | 產出分類與 retention 需求 | S3 bucket、IAM role、presigned URL adapter |
| 通知 | team channel / 收件規則 | connector、token、審計歸屬 |
| 紅區審核 | 發 PR、補 manifest | CODEOWNERS/curator review、kill switch |
| 緊急停用 | 可停自己的 schedule/run | 平台可撤 secret、停 CronJob、封 endpoint |

## 14. 落地里程碑

### M0：文件收斂

- DevOps spec 成為 README、CLAUDE、template、proposal 的最高約束。
- Dkron/vibefile/vibe runner 等非主線能力移到 roadmap。
- `PROJECT.yaml` / manifest / `.env.example` 範例對齊 cloud-ready。

### M1：Template 可用

- 新專案從 template 開出來即含 `docs/cloud-ready-spec.md`、`Dockerfile`、`.dockerignore`、health endpoint、job endpoint skeleton。
- guard 可檢查基本 cloud-ready 反模式。
- `ctx.log` 寫 audit log 前自動 masking。

### M2：Platform 接軌

- GitOps/Kubernetes CronJob 由 `PROJECT.yaml schedules` 自動產生。
- `ctx.storage` 對接 S3。
- `ctx.db` 對接 PostgreSQL。
- `ctx.notify` 對接公司通知 connector。

### M3：紅區治理

- CODEOWNERS/curator review。
- 多方參數狀態機。
- magic link / one-time token。
- kill switch / 重跑 / audit viewer。

詳細未實作清單見 `docs/roadmap.md`。
