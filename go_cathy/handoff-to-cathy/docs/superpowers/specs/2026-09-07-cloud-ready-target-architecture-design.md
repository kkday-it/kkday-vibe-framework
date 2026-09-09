# Cloud-Ready 上雲遷移 — 目標架構設計（步驟 2：Design）

- 最後修訂：2026-09-08（**定案 5 步流程：dump → 重構 → compose → 資料 → UAT**）
- 對照規範：`vibe-cloud-ready-spec.md`（2026-09-04）
- 前置文件：`2026-09-07-cloud-ready-migration-gap-report.md`（步驟 1）、`2026-09-08-devops-sync-decisions.md`

---

> ## 🔴 定案流程（2026-09-08，本節與 §0 為準；覆蓋下方 §1–§5 舊敘述）
> 不做「先把舊版容器化」的丟棄工，**一次建對的東西**。5 步：
> ```
> ① G0：Supabase dump（盡快·最高優先·Cathy）— 搞清楚 Supabase 做了哪些事
> ② 照規範重構（去 Supabase）— 用 dump 結果，建符合 vibe-cloud-ready-spec 的版本
>       DevOps 形狀約束：不拆前後端、不用 FastAPI、一個 docker-compose
> ③ compose 確定能動 — 起來的就是「重構後」的版本（非舊版）
> ④ 帶入基本資料 — 本機 Postgres 灌 sample data
> ⑤ UAT — 在本機重構版 + sample data 上驗（不碰正式 Supabase，安全）
> ```
> - **關鍵相依**：② 重構卡在 ① dump（沒 dump 出 RPC/RLS/scan 邏輯就無法重建）→ **G0 是最高優先**。
> - **「維持現況連 Supabase」不是目標**——只有在需要「先能跑」時暫時連；終點是去 Supabase、照規範。
> - 下方 §1–§5 是舊「選項 A 前後端分離／FastAPI」設計，**保留作日後重構的參考素材**（重構形狀改用 DevOps 約束，非 FastAPI）。

## 0. 已定決策（2026-09-08）

| # | 決策 | 選擇 |
|---|---|---|
| 1 | **流程** | **dump → 重構 → compose → 資料 → UAT**（砍「先容器化舊版」丟棄步） |
| 2 | **G0 優先級** | **最高、盡快**（Cathy 負責）；重構全卡在它 |
| 3 | 重構目標 | **照 `vibe-cloud-ready-spec` 去 Supabase**；形狀＝**不拆前後端、不用 FastAPI、一個 docker-compose** |
| 4 | repo | 新 `kkday-it/kkday-vibe-go-scheduling`（`vibe-project-template` 起手；現行不動、平行） |
| 5 | 資料層 | 去 Supabase → 本機/日後 RDS Postgres；**做法非 FastAPI、隨重構定**（依 dump 結果）|
| 6 | 認證 | 去 Supabase Auth → Google OAuth + 自管 JWT（重構時做）|
| 7 | Realtime | 去 Supabase Realtime → 前端輪詢（重構時做）|
| 8 | 批次/排程 | 統一 dispatcher；排程 **ArgoCD/GitOps → CronJob**（非 GitHub Actions/in-process）|
| 9 | 通知 | **寬工作窗 dispatch + 早發非 ping 廣播**（讀 code 修正，非 per-時區 24h）；事件型待 G0 |
| 10 | approve_staff_request（**DB RPC，非 Edge Function**） | 後端通用核准 endpoint（非 Slack webhook）；邏輯照 `01_schema.sql` 的 RPC 定義實作 |
| 11 | DB TLS | 內網不強制（sslmode 非爭點；若用則 psycopg `require`）|
| 12 | UAT | **本機重構版 + sample data**（安全，不碰正式 Supabase）|
| 13 | Cutover（EKS 上線）| 台北凌晨 + 短維護窗 + 最後同步 + 熱備、不雙寫（重構穩定、要上 EKS 時才用）|

---

## 1. 元件拓撲

新系統開在**新 repo `kkday-it/kkday-vibe-go-scheduling`**（非現行 `kkday-go-scheduling`，後者維持營運不動；見 §0 決策 #11）。單 repo、三 image 對到三種 k8s workload，**共用一層 Python 資料存取層**（`shared/`，backend 與 batch 都 import；一套 SQL 邏輯兩邊用，不重寫）。

```
使用者（@kkday.com，僅 VPN/內網可達）
  │ 瀏覽器
  ▼
[image 1: -frontend]  nginx 服 React 靜態檔（A 型：PORT / 0.0.0.0 / /health）
  │ 只打自家後端 API，不再直連 Supabase
  │ HTTPS + 自管 JWT
  ▼
[image 2: -backend]  FastAPI（A 型）
  - 取代前端 121 處 Supabase 呼叫 → REST API
  - Google OAuth callback + 發 JWT
  - 應用層授權（取代 RLS）
  - /health（無外部依賴）
  │ 直連 PG（TLS，連線池小）
  ▼
[AWS RDS PostgreSQL] ◀── 同一套 DB，共用 shared/ 資料存取層 ──┐
  ▲                                                          │
  │ 直連 PG                                                   │
[image 3: -batch]  Python（B 型 CronJob ×N）─────────────────┘
  - 統一 dispatcher，args 傳工作名
  - schedule-engine / task-engine / dispatch-notifications /
    backfill-slack-ids / scan-c4 / scan-f1a / scan-f1b / scan-publish
  - → Slack（外部 host）
```

image 名：`kkday-vibe-go-scheduling-frontend` / `-backend` / `-batch`（= 新 repo 名 + 後綴，全小寫，§4.10）。

**前端去 Supabase 化**：移除 `@supabase/supabase-js`，退化成「純靜態 SPA + 打自家 API」。

---

## 2. 資料層與 schema 遷移

### 2.1 schema 出土 → 進版控（硬約束 7）
- Supabase `pg_dump --schema-only` → `db/migrations/0001_baseline.sql`（table/index/sequence/constraint）
- 之後變更走 `db/migrations/NNNN_<描述>.sql`：四位數、forward-only、additive、字典序執行、已套用永不改
- `db:migrate` runner：讀 env 連線 → advisory lock → `CREATE TABLE IF NOT EXISTS schema_migrations` → 只跑沒記錄的 → 可重跑安全；CI 呼叫它
- RDS 已有資料時，baseline 標「已套用」不重跑
- 單一 transaction／檔，禁 `CREATE INDEX CONCURRENTLY` 等（§4.5）
- ⏳ 待盤點：dump 未取得前 baseline 是空殼

### 2.2 RPC function 去處
- `fn_get_engine_*`（引擎讀資料）→ 搬進 batch `shared/`，改寫 Python + SQL
- `fn_scan_*` 四支（業務邏輯）→ 搬進 batch `batch/scans/`，各成一支工作
- `fn_org_family` / `fn_get_task_fairness` 等 → 依呼叫端搬進 backend 或 shared
- 原則：**DB 只留資料、不留邏輯；runtime 不做 DDL**
- ⏳ 待盤點：function body 皆不在 repo，搬遷量待 dump

### 2.3 RLS → 應用層授權（§4.5）
- 後端每個 endpoint 用 JWT 內 user/org/role 做授權判斷
- ⏳ 待盤點：RLS policy = 授權規則權威來源，必須匯出才能正確重建

### 2.4 資料存取層 `shared/db.py`
- 直連 PG：`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`，允許 `DATABASE_URL` 短路
- **TLS 必開**，psycopg 用 **`sslmode=require`**（加密不驗 CA，符規範原意）。⚠️ 上游 `vibe-cloud-ready-spec.md` §4.5 原寫 `no-verify`，但 **libpq/psycopg 不接受此值**（Node `pg` 系用語）→ 本專案用 `require`。已於 CHANGELOG 記為 spec 衝突。
- 連線池小（單 pod 個位數），`pod 數 × pool ≪ RDS max_connections`
- app DB 帳號**只有 CRUD**，無 DDL
- 輕量：`psycopg` + 手寫 SQL 或輕 ORM

---

## 3. 認證 + 前端改寫 + Realtime + Edge Function

### 3.1 認證（Supabase Auth → Google OAuth + JWT）
- 前端點登入 → 後端 `/auth/google` → Google OAuth（`hd=kkday.com` 限域）→ callback 打回**後端** `/auth/callback` → 驗 Google id_token + 確認 `@kkday.com` → 發自管 JWT
- JWT 放 `HttpOnly`+`Secure`+`SameSite` cookie；帶 user_id / org / role
- callback URL 由 `APP_BASE_URL` env 組（不硬寫）；後端信任 `X-Forwarded-*`（§4.6）
- adapter：`auth.currentUser()` 介面，`AUTH_PROVIDER=google`（保留換 SSO 空間）

### 3.2 前端改寫（121 處直連 → 打自家 API）
- `src/lib/supabase.js` → `apiClient.js`（fetch wrapper，自動帶 JWT cookie）
- 10 個 `*Api.js` 的 `.from/.rpc` → 對應後端 REST endpoint，介面盡量對齊減少 page 改動
- ⏳ 待盤點：每個 `.rpc` 對應的 function body 決定 endpoint 實作

### 3.3 Realtime 替代（首頁 / 我的今日工作頁）
- **前端輪詢**（§4.3 明許 best-effort：有就更快、沒有也正確）
- 理由：內部工具、即時性要求不高；輪詢無狀態、多副本安全，免 WebSocket 的 sticky session / 重連
- 前端每 N 秒打輕量 `/api/.../updates?since=`
- ⏳ 待盤點：訂閱哪些表/事件 → 決定輪詢哪幾支、頻率

### 3.4 Edge Function 去處
- `trigger-task-engine`（前端按鈕觸發排班）→ **前端 → 後端 `/api/jobs/task-engine`（帶 JWT）→ 後端起 k8s Job**（或寫 job 佇列進 DB 由 CronJob 撿）
- `approve_staff_request`（**DB RPC、非 Edge Function**；經 Cathy 2026-09-08 澄清：非 Slack 按鈕，是「依 request 類型的通用核准流程」）→ 新建**後端通用核准 API endpoint**（如 `POST /api/requests/{id}/approve`），供前端審核介面呼叫。**不撞 §4.6 webhook 禁令**（原「Slack 給連結/輪詢 Slack 事件」的設計作廢）。RPC 定義隨 G0 `01_schema.sql` 匯出，照其業務邏輯實作

---

## 4. 批次打包 + 部署 + 排程

### 4.1 批次打包（8 支 → 1 batch image + dispatcher）
- 進入點 `batch/main.py`，讀第一個 arg 決定跑哪支；**不帶參數印工作清單**（§1.4）
- 工作名：`schedule-engine` / `task-engine` / `dispatch-notifications` / `backfill-slack-ids` / `scan-c4` / `scan-f1a` / `scan-f1b` / `scan-publish`
- ENTRYPOINT 用 **tini**（轉送 SIGTERM），工作名 **`args:` 傳**（`command:` 會蓋掉 tini，§4.7）
- 每支：idempotent（DB 台帳）、失敗非零退出 + Slack 通知、印 JSON 摘要（§4.7）

### 4.2 部署對應

| image | workload | 備註 |
|---|---|---|
| `-frontend` | Deployment + Service + Ingress | nginx，ALB 內網，`/health` |
| `-backend` | Deployment + Service + Ingress | FastAPI，`/health` 無外部依賴 |
| `-batch` | CronJob ×N + 手動 Job | 每支工作一 CronJob；`task-engine` 可由後端起 Job |
| migration | CI step | 部署前跑 `db:migrate`，失敗擋部署 |

- k8s manifest 由平台維護在 GitOps repo；我方 repo **不放 k8s YAML**（§5）
- image tag = commit 短 SHA、不可變；回滾 = tag 指回上一個 SHA

### 4.3 排程重排（§4.7 排上班時段、避免夜間縮容）

| 工作 | 現在（台北） | 問題 | 方案（Cathy 2026-09-08 確認） |
|---|---|---|---|
| `scan-f1b-daily-broadcast` | 04:00 凌晨 | 夜間可能縮容 | ✅ **已接受**移上班時段（如 08:30）；改走 CronJob（04:00 部分肇因於 GH Action 延遲） |
| `dispatch-notifications` | 全天每 5 分 | 夜間跑、過密 | **寬工作窗即可**（如台北 07:00–21:00）。讀 code 修正（2026-09-08）：`notification_log` 無時區/送出時間欄位、`dispatch` 無腦沖佇列、**時區是 display 端轉換**、04:00 廣播**非 ping** → 沒有「per-時區 24h 送」這回事，不需夜間 CronJob。**唯一待 G0 確認**：前端動作是否即時塞事件型通知（換班/請假/核准）。 |
| 其餘 6 支 | 08:00–20:00 | ✅ 已在時段內 | 不動 |

> 🔴 **播報 vs 通知**：`scan-f1b` 播報移上班時段（OK）；`dispatch` 是沖佇列器、跑寬工作窗即可（詳見 `2026-09-08-devops-sync-decisions.md`「通知機制真相」）。

- 時間全程 UTC 存、商業邏輯顯式帶時區（§4.7），不靠系統 local time

---

## 5. 錯誤處理 + 測試 + 第一關落地

### 5.1 錯誤處理 / 健康檢查（§4.9）
- 後端 `/health`：`200 {"status":"ok"}`，不查 DB / 外部 / 不需登入（liveness+readiness 共用）；依賴狀態另開 `/health/deps`，不接 probe
- 缺必要 env → fail fast 列缺項；空字串當「沒設」（trim 後空即缺，§4.2）
- 批次失敗 → 非零退出 + Slack 通知
- log 走 stdout、一事件一行 JSON、不含 token/個資
- Sentry DSN 走 env，沒設安靜停用

### 5.2 對外送出保險（§1.6）
- `dispatch-notifications`、`backfill`、scan 播報加 `NOTIFY_DRY_RUN` 一票否決
- 寫在 compose.yml / CronJob `environment:`（看得見），**不放 `.env`**，預設關（dry-run）
- 真發才 CLI 覆寫 `-e NOTIFY_DRY_RUN=`

### 5.3 測試策略
- `.env.example` 守門測試（§1.7）：讀了沒列→紅、列了沒讀→紅、每 key 標分類
- migration 冪等：空 PG 跑一次建全 schema、再跑一次不失敗（§7）
- 批次 idempotent：同工作連跑兩次結果一致
- 授權測試：逐 endpoint 驗「誰能看什麼」— ⏳ 待 RLS policy 出土
- 連通性自檢腳本（§4.6）：只發 GET 印各外部 host 狀態碼，本機留底、平台叢集跑同一支比對 egress

### 5.4 第一關落地（§1.8，最先做、不卡平台）
> 對齊 plan Phase 1：第一關**只做 frontend + batch 兩個 image**（backend 尚不存在，其 `Dockerfile.backend` 於 Phase 3 後端骨架時才建）。
- 兩個 Dockerfile：`Dockerfile.frontend`（nginx 非 root/唯讀）、`Dockerfile.batch`（tini 非 root）；`.dockerignore`、釘 base image major
- `compose.yml`：frontend(A) / batch(B) / 本機 Postgres（§1.3，不用 SQLite）；backend service 待 Phase 3 補
- `requirements.txt` + `constraints.txt` 進版控、`--frozen`
- `.env.example` 補全所有 env + 分類（build-time / runtime-secret / runtime-plain）
- README：本機怎麼跑 + 部署備註 + 外部 host 清單

### 5.5 外部 host 清單（交平台確認 egress）
- Slack API（`slack.com`）
- Google OAuth（`accounts.google.com` / `oauth2.googleapis.com`）
- 遷移過渡期 Supabase（若分階段）

---

## 6. ⏳ 待盤點清單（阻擋工作量估算，步驟 3 前置閘門）

> **G0 負責人：PM Cathy**（2026-09-08 確認，會用 AI 協助執行 Supabase dump）；RD 端協助接收與落地驗證。

沿用 gap report §5，設計階段確認全部仍為前置閘門：

1. table schema DDL（→ `0001_baseline.sql`）
2. 所有 RPC function body（含 scan 四支業務邏輯）
3. RLS policies（授權權威來源）
4. Supabase Auth 設定（user 對應 / session）
5. Storage buckets（`exportApi` / `ScheduleUpload` 是否用到）
6. Realtime 訂閱範圍（哪些表/事件）
7. Edge Function 原始碼 `trigger-task-engine`（唯一 Edge Function）；`approve_staff_request` 為 **DB RPC、非 Edge Function**，隨 `01_schema.sql` 匯出
8. 其他 triggers / views / 同專案其他排程
9. 各表 row counts + dump（遷移後對數）

**取得方式**：Supabase 專案 access（我自行 dump）／owner 提供匯出檔。

---

## 7. 業務確認清單（2026-09-08 與 Cathy 會議更新）

### ✅ 已確認（closed）
- **`scan-f1b` 班表播報**：移上班時段（如 08:30）— **接受**（改走 CronJob）。
- **Realtime 降級輪詢**：首頁 / 今日工作頁 — **接受**（近即時可）。
- **UAT 驗收模式**：由 **Cathy 主驗收** — 接受。
- **個資處理**：無阻擋性顧慮 — 已確認。
- **Cutover 切換方案**：台北凌晨 + 短維護窗(~15分) + 最後同步 + DNS 切 + 舊系統唯讀熱備，不雙寫；已核准請假/已公佈班表必進最後同步 — 已議定（見 plan G1/Phase 7）。

### ❌ 已推翻 / 作廢（invalid）
- ~~`approve-staff-request` Slack 按鈕改連結~~ — **證實目前無 Slack 核准按鈕**，是通用核准流程 → 改後端核准 endpoint（§3.4）。
- ~~`dispatch-notifications` 限上班時段~~ — **員工跨時區、否決**，改「依收件人時區發送」（§4.3）。

### ⏳ 仍未決（open，要再問）
- **Q7 員工時區分布** — 定「寬工作窗」的上下界、確認廣播時間覆蓋各時區早晨時需要它。
- **Q9 Cutover 可接受凍結時長上限 + 絕對禁切時段**（如每月 25 號引擎、月底公佈）。
- **G0：`approve_staff_request` RPC 定義**（DB RPC，隨 `01_schema.sql` 匯出，含在 G0，Cathy 負責 dump）。

---

## 8. 對步驟 3（Migration Plan）的輸入

- 分階段策略（strangler / big-bang）待步驟 3 定；本設計相容漸進切換。
- 每階段須有：完成條件、驗證方式、回滾方案。
- **§6 待盤點是所有「碰 Supabase 邏輯」階段的硬前置**；未解除前，schema / RPC / 授權 / Realtime 相關階段只能排在盤點之後。
- 第一關（§5.4）不依賴任何盤點與平台資源，**可立即開始**。
