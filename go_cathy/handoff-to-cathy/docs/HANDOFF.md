# 交接說明 — kkday-go-scheduling 上雲遷移

> 一頁看懂這包是什麼、誰做什麼、先做什麼。**實作由貴團隊（RD / AI coding agent）進行**，本包提供把它做對所需的全部資訊。

---

## 這包是什麼

kkday-go-scheduling 目前建在 **Netlify（前端）+ Supabase（BaaS）+ GitHub Actions（排程）**。要照公司規範**去 Supabase、重構**。

> 🔴 **定案 5 步流程（先讀 `superpowers/specs/2026-09-08-devops-sync-decisions.md`）**：
> **① G0 Supabase dump（盡快·Cathy）→ ② 照 `vibe-cloud-ready-spec` 重構（去 Supabase）→ ③ 本機 compose 能動 → ④ 灌 sample data → ⑤ UAT（本機、安全）。**
> - ② 重構卡在 ① dump（沒料無法重建）→ **G0 最高優先**。形狀：**不拆前後端、不用 FastAPI、一個 docker-compose**；內網不強制 SSL；cron 日後 ArgoCD。
> - **不做「先把舊版容器化」的丟棄工**——一次建對的東西。
> - ⚠️ `plans/` 與 `specs/design` 內含大量**舊路線**（Phase 1–7 容器化現有版 / 選項 A / FastAPI / RDS）——**已被 5 步流程取代**，以各檔頂部 banner 為準；工程片段可在 ② 複用。

**目前狀態：只有文件、尚無實作。** 下一步＝① G0 dump（Cathy）。

---

## 誰做什麼

| 角色 | 負責 |
|---|---|
| **貴團隊 RD / AI agent** | 照 `plans/` 實作遷移；接收 G0 資料並落地驗證 |
| **Cathy（PM）** | UAT 驗收 + 業務決策拍板；**G0 Supabase dump 負責人**（會用 AI 協助執行） |
| **平台團隊** | 開 EKS namespace / RDS / S3 / config-manager / GitOps |

---

## 閱讀順序（核心四份，缺一不可）

1. **`vibe-cloud-ready-spec.md`**（本目錄）— 硬約束權威。所有設計規則來源，**先讀**。
2. **`superpowers/specs/2026-09-07-cloud-ready-migration-gap-report.md`** — 現況 vs 規範的落差（哪裡不符、為什麼要改）。
3. **`superpowers/specs/2026-09-07-cloud-ready-target-architecture-design.md`** — 目標架構與已定決策。
4. **`superpowers/plans/2026-09-07-cloud-ready-migration.md`** — 實作計畫（頂部為 5 步流程；下方舊 Phase 1–7 已被取代、工程片段可在 ② 複用）。**下一步＝① G0 dump（Cathy）**；② 重構的細計畫待 G0 出料才展開。

> plan 刻意寫成「讀者對此 codebase 零背景」的格式——精確檔案路徑、完整 code、指令、預期輸出。貴方 AI agent 幾乎能照著逐步執行。

---

## 先做什麼（當前唯一線路）

定案 5 步流程下，**當前唯一的線路就是 ① G0**，沒有「先容器化舊版」的過渡步：

### ① G0 Supabase dump（最高優先，**Cathy 執行**，會用 AI 協助）
**Cathy 盡早從 Supabase 匯出以下 9 樣**，RD 端接收（詳見 `handoff-to-cathy/G0-EXPORT-GUIDE.md`）。② 重構完全卡在這份匯出——沒料無法重建。取得 G0 後由 RD 接手 **② 照規範重構（去 Supabase、單一 docker-compose）**，**不做**中間過渡的舊版容器化：

1. 完整 table schema DDL（`pg_dump --schema-only`）
2. 所有 RPC function body（含 `fn_scan_*` 四支、`fn_get_engine_*`、`fn_org_family`、`fn_get_task_fairness`）
3. RLS policies（授權規則權威來源）
4. Supabase Auth 設定
5. Storage buckets（是否有）
6. Realtime 訂閱範圍（哪些表 / 事件）
7. **Edge Function 原始碼**（`trigger-task-engine`——唯一的 Edge Function；註：`approve_staff_request` 是 DB RPC，已由第 1、2 項的 schema/function dump 涵蓋，不在 Edge Functions 頁面）
8. 其他 triggers / views / 同專案排程
9. 各表 row counts + 資料 dump（供遷移後對數）

---

## 給貴方 AI agent 的一句設定

請在貴團隊的 AI 系統提示 / `CLAUDE.md` / `.cursorrules` 加：

> 「本專案最終部署在公司內部 EKS，開發任何功能前先讀 `docs/superpowers/specs/` 與 `docs/superpowers/plans/`，所有設計必須符合 `vibe-cloud-ready-spec.md` 的約束。」

---

## 業務決策狀態（Cathy 2026-09-08 已拍板）

**✅ 已確認**
- 首頁/今日工作頁：即時推播 → **每幾秒輪詢**（接受）
- 班表播報：凌晨 04:00 → **移上班時段**（接受，改走 CronJob）
- UAT 由 Cathy 主驗收；個資無阻擋顧慮
- Cutover：**台北凌晨 + 短維護窗(~15分) + 最後同步 + 熱備，不雙寫**（見 plan G1/Phase 7）

**❌ 已推翻**
- ~~員工核准 Slack 按鈕→連結~~：**證實無 Slack 核准按鈕**，是通用核准流程 → 後端核准 endpoint
- ~~通知限上班時段 / 依收件人時區 24h 送~~：讀 code 後修正——通知是佇列沖出器、時區為 display 端、廣播非 ping → **寬工作窗即可**（不需夜間 CronJob）；事件型通知待 G0（見決策檔「通知機制真相」）

**⏳ 仍未決（要再問 Cathy）**
- 員工時區分布 / 各時區發送尖峰（Q7）
- Cutover 可接受凍結時長 + 絕對禁切時段（如 25 號引擎、月底公佈）（Q9）

---

## ⚠️ 一個已知的源 spec 錯誤（實作時注意）

`vibe-cloud-ready-spec.md` §4.5 寫 DB 連線用 `sslmode=no-verify`，**但 libpq / psycopg 不接受此值**（那是 Node `pg` 系用語）。本專案後端用 psycopg → 請用 **`sslmode=require`**（加密但不驗 CA，符合規範原意）。已在 `superpowers/specs/CHANGELOG.md` 記錄，建議 spec 維護者評估修訂。

---

## 文件地圖

```
docs/
├── HANDOFF.md                                   ← 你正在讀這份
├── vibe-cloud-ready-spec.md                     硬約束權威（先讀）
├── superpowers/
│   ├── specs/
│   │   ├── 2026-09-07-cloud-ready-migration-gap-report.md        現況落差
│   │   ├── 2026-09-07-cloud-ready-target-architecture-design.md  目標架構
│   │   └── CHANGELOG.md                                          決策/review 軌跡
│   ├── plans/
│   │   └── 2026-09-07-cloud-ready-migration.md                   實作計畫（Phase 1 完整）
│   └── qa/
│       └── 2026-09-07-uat-checklist-cathy.md                     Cathy UAT 清單
```

另有 4 份對外溝通用 HTML（before/after 技術版、ELI5 白話版、平行遷移策略、UAT 互動版）—— 由交付者另行提供連結。
