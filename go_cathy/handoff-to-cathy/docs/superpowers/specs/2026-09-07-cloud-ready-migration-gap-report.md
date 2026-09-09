# Cloud-Ready 上雲遷移 — Gap Report（步驟 1：Discovery）

- 最後修訂：2026-09-08（併入 Cathy 會議定案）
- 對照規範：`vibe-cloud-ready-spec.md`（最後修訂 2026-09-04）
- 受檢對象：`kkday-go-scheduling`（現行）；目標新 repo `kkday-vibe-go-scheduling`
- 流程（2026-09-08 定案）：**① G0 dump → ② 照 `vibe-cloud-ready-spec` 重構（去 Supabase）→ ③ 本機 compose 能動 → ④ 灌 sample data → ⑤ UAT**。形狀＝不拆前後端、不用 FastAPI、一個 compose。見 `2026-09-08-devops-sync-decisions.md` + design §0。
- 本檔用途：**現況落差分析（盤點）**，findings 描述**現行系統**、仍有效——是 ② 重構的輸入。下方「目標＝EKS/RDS/前後端分離」等敘述屬舊路線，供背景參考。

---

## 0. 一句話結論

現況是 **Netlify（前端 PaaS）+ Supabase（BaaS，兼資料庫/後端邏輯/認證）+ GitHub Actions（排程 PaaS）** 三件套，正中 spec §2 明列的「非目標環境」。上雲不是「換一組 env」的距離，而是要**新建自管後端 API 層、把資料層從 Supabase REST 改成直連 RDS、把排程從 GitHub Actions 改成 k8s CronJob、把 schema 與 RPC 邏輯從 Supabase 端搬回版控**。第一關（本機 docker compose）目前 0 分。

---

## 1. 現況架構總覽（inventory）

### 1.1 前端（React SPA）

| 項目 | 現況 |
|---|---|
| 框架 / build | Vite 5 + React 18，`npm run build` → `dist/` |
| 部署 | Netlify（`netlify.toml`，SPA fallback 到 `index.html`） |
| 資料存取 | **直連 Supabase**，全專案 **121 處**呼叫（`40 × .from`、`75 × .rpc`、`6 × .auth`），散落 **33 個檔案** |
| adapter | **無**。`src/lib/supabase.js` 的 client 被各 `*Api.js` 與 page 直接 import |
| 認證 | Supabase Auth，magic-link OTP（`signInWithOtp`），email 限 `@kkday.com`，授權推測靠 Supabase RLS |
| 對外設定 | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，**build-time embed 進 bundle** |

`src/lib/` 資料存取檔：`scheduleApi`、`swapApi`、`dailyTasksApi`、`notificationApi`、`fairnessApi`、`engineReviewApi`、`enginePublishApi`、`exportApi`、`orgScope`、`scheduleWarnings`、`supabase`。

### 1.2 後端 / 資料層

**目前沒有自管後端。** 前端直接把 Supabase 當後端用：

- 資料存取：Supabase PostgREST（`/rest/v1/...`）；已知表：`schedule_days`、`notification_log`、`daily_task_segments` 等
- 業務邏輯：大量落在 **Supabase RPC function**（`fn_get_engine_*`、`fn_scan_*`、`fn_org_family`、`fn_get_task_fairness`、task 相關…），**定義在 Supabase 端、不在 repo**
- 授權：推測靠 **RLS policy**（同樣不在 repo）
- 底層 DB：Supabase 託管的 PostgreSQL
- **Supabase Realtime**：首頁 / 「我的今日工作」頁靠 Realtime 即時推播（BaaS 專屬能力，無現成替代）
- **Supabase Edge Functions**（原始碼皆不在 repo）：
  - `trigger-task-engine`：前端按鈕 → 呼叫 GitHub Actions API 觸發 task-engine workflow
  - `approve_staff_request`：**是資料庫 RPC（Stored Procedure），非 Edge Function**。呼叫端在 repo（`StaffRequests.jsx:176` = `supabase.rpc('approve_staff_request')`）；RPC 定義本體在 Supabase、隨 G0 的 `01_schema.sql` 匯出（不必去 Edge Functions 頁找）。經 PM Cathy 確認（2026-09-08）：**目前沒有 Slack 互動按鈕核准**，這是「依不同 request 類型做核准的**通用流程**」，性質接近前端呼叫的後端核准邏輯（非外部 webhook）。

> 來源：`README-系統架構.md`（整理自 zip 匯出版 + Supabase Dashboard 畫面，非即時掃描）+ 2026-09-08 與 Cathy 會議澄清。表名、RPC、Realtime、Edge Function 皆需進 Supabase 專案核實。

### 1.3 批次作業（Python，跑在 GitHub Actions）

| # | 進入點 | 觸發 | 台北時間 | 做什麼 | 外部依賴 |
|---|---|---|---|---|---|
| 1 | `scheduling_engine.py` | cron `0 0 25 * *` + 手動 | 每月 25 號 08:00 | OR-Tools CP-SAT 排班（最壞 ~17 分鐘） | Supabase RPC/REST |
| 2 | `task_engine.py` | 手動（前端按鈕 → GitHub API `workflow_dispatch`） | — | 每日任務重排，`--root-org --date` | Supabase |
| 3 | `dispatch_notifications.py` | cron `*/5 * * * *` | **全天每 5 分鐘** | 送 Slack 通知（⚠️ 收件人**跨時區**，Cathy 2026-09-08 確認須按各自時區準時送，**不可限台北上班時段**） | Supabase + Slack API（**硬寫 netlify URL**） |
| 4 | `backfill_slack_ids.py` | cron `0 1 * * *` + 手動 | 每天 09:00 | 回填 Slack user id | Supabase + Slack API |
| 5 | `scan-c4-cancel-deadline` | cron `0 1 * * *` | 每天 09:00 | curl → `fn_scan_c4_cancel_deadline()` | **邏輯在 Supabase RPC** |
| 6 | `scan-f1a-tomorrow-plan` | cron `0 12 * * *` | 每天 20:00 | curl → `fn_scan_f1a_tomorrow_plan()` | **邏輯在 Supabase RPC** |
| 7 | `scan-f1b-daily-broadcast` | cron `0 20 * * *` | **隔天 04:00（凌晨）** | curl → `fn_scan_f1b_daily_broadcast()` | **邏輯在 Supabase RPC** |
| 8 | `scan-publish-reminder` | cron `0 2 27 * *` | 每月 27 號 10:00 | curl → `fn_scan_publish_reminder()` | **邏輯在 Supabase RPC** |

> #5–#8 的實際商業邏輯**完全在 Supabase RPC function 裡**，GitHub Actions 只是個 curl 觸發器。搬遷時這 4 段邏輯要不搬進批次 code、要不搬進後端 API，且都要先從 Supabase 匯出。

### 1.4 Secret 現況

全部走 **GitHub Actions Secrets**（非平台 config-manager）：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（long-lived、高權限）、`SLACK_BOT_TOKEN`、`ENGINE_ALERT_CHANNEL`。前端 `VITE_*` 為 build-time embed。

---

## 2. 專案形狀判定（§1.1）

現況是**混合形狀**，目標拆成兩類 workload：

| 元件 | 目標形狀 | 說明 |
|---|---|---|
| 前端 SPA | **A 型**（nginx 容器服靜態檔） | 監聽 `PORT`、綁 `0.0.0.0`、`/health`、ALB 內網 |
| 後端 API（新建） | **A 型** | 取代 121 處 Supabase 直連，直連 RDS |
| `scheduling_engine` / `task_engine` / `dispatch_notifications` / `backfill_slack_ids` | **B 型** CronJob | 跑完即止，工作名用 `args` 傳 |
| `scan-*`（4 支 RPC 邏輯） | **B 型 CronJob 或收進後端 job endpoint** | 邏輯要先從 Supabase 搬出 |

> `scheduling_engine` 最壞 17 分鐘 > ALB 60 秒 timeout → **只能 B 型 CronJob**，不能硬包 HTTP endpoint（§1.1/§4.7）。

---

## 3. 逐條 Gap（12 硬約束，§3）

圖例：✅ 符合｜🟡 部分/待確認｜❌ 不符合｜⛔ 嚴重不符合｜⬜ 待建

| # | 約束 | 判定 | 現況與差距 |
|---|---|---|---|
| 1 | A 型：一容器一 process、監聽 `PORT`、綁 `0.0.0.0`（B 型不適用） | ⬜ | 無自管後端服務可上 EKS；前端目前是 Netlify 靜態站，未容器化 |
| 2 | 所有設定來自 env；secret 只 runtime 注入 | ❌ | 前端 `VITE_*` build-time embed 進 bundle；`SERVICE_ROLE_KEY` 走 GH secrets 非 config-manager |
| 3 | 完全無狀態 | 🟡 | 批次跑完即止 ✓；前端無 server state ✓；但 session 由 Supabase Auth 託管，換自管後要用簽章 cookie/JWT |
| 4 | 不寫本機磁碟（除 `/tmp`）；檔案進 S3 | 🟡 | 批次都寫回 DB、未見寫本地檔；**待確認** `exportApi` / `ScheduleUpload` 是否用 Supabase Storage |
| 5 | 不用 SQLite / 檔案型 DB / 佇列 | ✅ | 底層是 PostgreSQL、無 SQLite（但存取方式違反 #6） |
| 6 | DB = 外部 PostgreSQL，連線來自 env、需 TLS | ❌ | 全走 Supabase REST/RPC；無 `DB_HOST/DB_PORT/...` 直連、無直連 PG 的 TLS |
| 7 | schema 變更 = repo 內 forward-only migration；runtime 不做 DDL | ⛔ | **repo 無 `db/migrations/`**；table schema + 所有 RPC function（含 `fn_scan_*` 業務邏輯）+ RLS 全在 Supabase 端、不在版控 |
| 8 | 排程 = HTTP endpoint(A) 或 CronJob 跑映像(B)；非 in-process timer | ❌ | 用 **GitHub Actions cron**（PaaS 專屬排程宣告檔，§4.7 DON'T「EKS 不會讀」）；`trigger-task-engine` Edge Function 亦是這條觸發鏈的一環 |
| 9 | 雲端資源用 SDK 預設憑證鏈，程式內零 key | ❌ | 用 long-lived `SERVICE_ROLE_KEY`；未來接 S3 需改 IRSA |
| 10 | log 只寫 stdout/stderr | ✅ | Python `print` 到 stdout；無 log 檔 |
| 11 | A 型：無外部依賴的 health endpoint | ⬜ | 前端無後端故尚無 `/health`；後端 API 新建時要一併做 |
| 12 | 平台專屬能力包 adapter（auth/storage/mail/cron） | ⛔ | **121 處直連 Supabase 無 adapter**；Supabase Auth 直用；Slack 直接 curl；搬遷＝重寫。**另含兩項 BaaS 專屬能力**：(a) **Supabase Realtime** 即時推播（首頁/今日工作頁）無現成替代；(b) Edge Function `trigger-task-engine`（唯一）邏輯在 Supabase 端；另 `approve_staff_request` 為 **DB RPC**（非 Edge Function、在 schema dump 內） |
| 12-approval | `approve_staff_request`（DB RPC）去處 | 🟡 | ~~推測 Slack webhook 撞 §4.6~~ **已由 Cathy 澄清（2026-09-08）：無 Slack 核准按鈕，是「依 request 類型的通用核准流程」**。→ **不撞 §4.6 webhook 禁令**，降級為「後端通用核准 endpoint、RPC 定義隨 `01_schema.sql` 出土」的一般搬遷 |

**constraint 12 兩項新增細節：**
- **Supabase Realtime**：前後端分離後前端不再連 Supabase，Realtime 訂閱失效。**方案已定（Cathy 2026-09-08）：改前端輪詢**（§4.3 best-effort；不做 WebSocket/SSE）。⏳ 待盤點的只剩「訂閱哪些表/事件」→ 決定輪詢哪幾支、頻率。
- **Edge Function / 核准 RPC**：`trigger-task-engine`（唯一 Edge Function）改「前端 → 後端 API → 起 k8s Job」；`approve_staff_request` **是 DB RPC（非 Edge Function）**、經 Cathy 澄清為通用核准流程（非 webhook）→ 改後端核准 endpoint 即可，不再是 §4.6 阻斷項；原始碼隨 `01_schema.sql` 匯出（不需另等 Edge Function 出土）。

---

## 4. 第一關檢查（§1.8，本機 docker compose）

| 檢查項 | 判定 | 說明 |
|---|---|---|
| `.env.example` 涵蓋每個 env、值空、標分類 | ❌ | 只列 2 個前端 `VITE_*`，漏 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SLACK_BOT_TOKEN` / `ENGINE_ALERT_CHANNEL`；無分類註記 |
| `docker compose build` 成功 | ❌ | **無 Dockerfile、無 compose.yml** |
| build 不用 secret、不連內網 | 🟡 | 目前無 build 流程可驗；前端 build 需 `VITE_SUPABASE_*` |
| A 型 `curl /health` 回 200 | ⬜ | 無後端 |
| B 型不帶參數印工作清單 | ❌ | 批次各自 `argparse`，未提供統一 dispatcher 印可跑工作 |
| 缺 env 大聲失敗、不 fallback | ✅ | Python `sys.exit(1)` 列缺哪個；前端 `supabase.js` `throw` |
| 非 root 執行 | ⬜ | 無 Dockerfile |
| 只寫 `/tmp` | 🟡 | 未見寫本地檔（待確認 export/upload） |
| 全庫無 hardcoded localhost/網址/金鑰 | ❌ | `dispatch_notifications.py:297,312` 硬寫 `https://kkday-go-scheduling.netlify.app/...` |
| 對外通知開關預設關、寫在 compose 看得見處 | ❌ | 無 `NOTIFY_DRY_RUN` 類機制；`dispatch_notifications` 直接發 Slack（§1.6 重點風險） |
| Python 依賴 lockfile | ❌ | 無 `requirements.txt`，版本散在 workflow 的 `pip install` |
| README「本機怎麼跑 / 部署備註」 | ❌ | **無 README** |

---

## 5. 待盤點清單（Supabase 黑盒 — 必取，否則無法設計目標架構）

以下都在 Supabase 端、不在 repo，是 constraint 7/12 的核心黑盒。**步驟 2（設計目標架構）開始前必須取得**：

1. **完整 table schema（DDL）** — 供在 RDS 重建；含欄位型別、約束、index、sequence。
2. **所有 RPC function 定義** — `fn_get_engine_*`、`fn_scan_c4_cancel_deadline`、`fn_scan_f1a_tomorrow_plan`、`fn_scan_f1b_daily_broadcast`、`fn_scan_publish_reminder`、`fn_org_family`、`fn_get_task_fairness`、task 相關等。**scan 四支的業務邏輯完全在此**。
3. **RLS policies** — 前端直連靠 RLS 做「誰能看什麼」；搬到自管後端要把授權改寫在**應用層**（§4.5）。這是授權規則的權威來源。
4. **Supabase Auth 設定** — magic-link OTP + `@kkday.com` allowlist；要換成自管 **Google OAuth**（Workspace）+ JWT（§4.6/§4.8），需盤點 user 對應、session 機制。
5. **Storage buckets（若有）** — 確認 `exportApi` / `ScheduleUpload` 是否用 Supabase Storage；有的話要遷 S3。
6. **Supabase Realtime 訂閱範圍** — 前端訂閱哪些表 / 事件（首頁、我的今日工作頁）。**替代方案已定為輪詢**（Cathy 2026-09-08）；此處只需盤點訂閱範圍以決定輪詢哪幾支、頻率。
7. **Edge Function 原始碼 + 核准 RPC** — `trigger-task-engine`（唯一 Edge Function，觸發鏈要改）；`approve_staff_request`（**DB RPC、非 Edge Function**，隨 `01_schema.sql` 匯出；Cathy 已澄清為通用核准流程、非 webhook，照其邏輯實作後端核准 endpoint）。
8. **其他 triggers / views / materialized views / 其他掛在同專案的排程或 Edge Function**（README 明列為待工程師確認）。
9. **各表資料量（row counts）+ dump** — 供遷移後對數驗證（§8 交付項第 4 條）。

> **G0 負責人：PM Cathy**（2026-09-08 確認，會用 AI 協助執行 Supabase dump）；RD 端協助接收與落地驗證。
> 取得方式：Supabase 專案 access → `pg_dump --schema-only` + 匯出 function/policy/RLS/Edge Function。**這決定 gap report 後端章節能否從「待盤點」轉為實據。**

---

## 6. Gap 分級彙總

### ⛔ 阻斷級（決定能不能上 EKS）

1. **schema + RPC 邏輯不在版控**（#7）— 無 `db/migrations/`，含 scan 四支的業務邏輯。
2. **資料層直連 Supabase、無自管後端**（#6/#12，121 處）— 要新建後端 API + adapter。
3. **無 Dockerfile / compose.yml / .dockerignore / requirements.txt**（第一關）— 本機容器化 0 分。
4. **`.env.example` 缺一半 + 無分類**（§1.6/§1.7/§8）— 交平台的唯一依據不完整。

> ~~5. approve-staff-request 依賴外部 webhook~~ **已由 Cathy 澄清移除**（2026-09-08）：無 Slack 核准按鈕、是通用核准流程、不撞 §4.6 → 降級至結構級（見下方 #10a），只剩「原始碼待 G0 出土」。

### 🟠 結構級（第二、三關要重寫）

6. **排程用 GitHub Actions cron**（#8）— 8 支 workflow 要改 k8s CronJob / job endpoint；含 `trigger-task-engine` Edge Function 觸發鏈。
7. **Supabase Auth 直用、無 adapter**（#12）— 換自管 Google OAuth + JWT。
8. **Supabase Realtime 即時推播**（#12）— 前後端分離後訂閱失效，**已定改前端輪詢**（Cathy 2026-09-08，不做 WebSocket/SSE）；待盤點僅訂閱範圍與頻率。
9. **long-lived `SERVICE_ROLE_KEY`**（#9）— 雲端資源改 SDK 預設憑證鏈 / IRSA。
10. **前端未容器化、無 `/health`**（#1/#11）— nginx 容器化上 EKS。
10a. **`approve_staff_request` 通用核准流程（DB RPC，非 Edge Function）**（原 webhook 降級）— 改後端核准 endpoint；RPC 定義隨 `01_schema.sql` 出土（非阻斷）。

### 🟡 一般級

11. 硬寫 netlify URL（`dispatch_notifications.py`）→ `APP_BASE_URL` env。
12. 對外通知無 `NOTIFY_DRY_RUN` 保險（§1.6）。
13. 排程時段要重排，但**兩支要分開處理**（Cathy 2026-09-08）：
    - `scan-f1b` 班表播報 **凌晨 04:00 → 移上班時段（如 08:30）**：✅ 業務接受（給主管看、非逐人）。
    - `dispatch` 通知 **全天每 5 分**：讀 code 後確認是**佇列沖出器、時區為 display 端**、廣播非 ping → **寬工作窗即可、不需夜間 CronJob**（見 `2026-09-08-devops-sync-decisions.md`）；事件型通知待 G0。
14. 無 README；批次無統一 dispatcher（不帶參數列工作）。

### ✅ 已符合（遷移時保留）

- repo 名 `kkday-go-scheduling` = 全小寫 kebab-case（§4.10）
- 排程失敗有 Slack 通知（engine / task，§4.7「失敗要有人知道」）
- Python log 走 stdout（#10）
- 缺 env fail fast（§4.2）
- 底層是 PostgreSQL、非 SQLite（#5）
- cron UTC↔台北註解清楚、批次跑完即止（B 型精神）

---

## 7. 對步驟 2（目標架構設計）的輸入

gap report 收斂出設計階段必須回答的關鍵決策：

1. **後端 API 技術棧** — 沿用 Python（FastAPI/Flask，可與批次共用 model/資料存取層）還是 Node？121 處前端呼叫要對應成 API endpoint。
2. **資料存取層設計** — 直連 PG（`DB_*` env + TLS）+ 輕量 SQL/ORM；RPC 邏輯搬進後端 service。
3. **授權層搬遷** — RLS → 應用層授權（§4.5）。
4. **Auth adapter** — Supabase magic-link → 自管（Google OAuth / 內部 SSO？待定）+ JWT。
5. **批次打包策略** — 4 支 Python + 4 支 scan 邏輯 → 統一 dispatcher（`args` 傳工作名）+ B 型 CronJob；`scheduling_engine` 記憶體上限（OR-Tools）要估給平台。
6. **repo / image 切分** — 前端、後端、批次是同 repo 多 Dockerfile 還是拆 repo（image 名 = repo 名，§4.10）。
7. **schema 出土與 baseline** — 從 Supabase dump → `db/migrations/0001_baseline.sql` + 標記已套用機制（§4.5）。

---

## 8. 本階段狀態

- ✅ 現況 inventory、逐條 gap、分級彙總完成。
- ⏳ **卡點**：Supabase 後端（§5 清單）需取得才能把「待盤點」轉實據、並支撐步驟 2 設計。
- ⛔ 本階段**未改任何 code**（符合 discovery 原則）。

**下一步**：確認 §5 Supabase 存取方式 → 補齊後端章節 → 進入步驟 2（設計目標架構）。
