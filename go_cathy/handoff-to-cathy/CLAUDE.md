# CLAUDE.md — kkday-go-scheduling 上雲交接包

給在此資料夾工作的 AI agent（Claude Desktop）的規則。使用者是 **PM Cathy**（非工程背景）——白話、少術語、先講結論。

## 定案流程（2026-09-08）與這個 session 要做什麼

整體 5 步：**① G0 Supabase dump（盡快·Cathy）→ ② 照 `vibe-cloud-ready-spec` 重構（去 Supabase）→ ③ 本機 compose 能動 → ④ 灌 sample data → ⑤ UAT（本機、安全）。** ② 重構卡在 ① dump。現行線上系統全程不動。

**Cathy 這個 session 只做 ①：G0（Supabase 匯出）。** ②③④ 是 RD 的 AI、⑤ Cathy 驗收。
> 重構（②）的形狀約束：**不拆前後端、不用 FastAPI、一個 docker-compose**；具體資料層/認證/Realtime 替代做法**依 G0 dump 結果定**。
> ⚠️ `docs/` 裡有大量**舊路線**內容（「Phase 1 容器化現有版、維持 Supabase」「選項 A 前後端分離 / FastAPI / RDS」）——**已被 5 步流程取代**，別照它做；工程片段（dispatcher/env/dry-run/Dockerfile）可在 ② 複用。以本檔 + `docs/superpowers/specs/2026-09-08-devops-sync-decisions.md` + 各檔頂部 banner 為準。

## 你（Claude Desktop）怎麼起跑

1. 先讀本檔 + `START-HERE.md`。
2. Cathy 的主線任務＝**照 `G0-EXPORT-GUIDE.md` 執行**（同層檔案）。
3. 你需要能：讀本資料夾、跑終端指令（`pg_dump`、`psql`）、開瀏覽器操作 Supabase Dashboard。**若你的環境不能跑指令/連 DB**，就把指南轉成「請 Cathy 或 RD 執行」的清單，別假裝跑過。
4. Supabase 存取（連線字串、Dashboard 登入）由 **Cathy 提供**；沒有就先跟她要，不要卡在猜。

## Cathy 的 G0 任務（你的主線）

**照 `G0-EXPORT-GUIDE.md` 一步步做**，匯出 9 樣進 `supabase-export/`。要點：
- **`approve_staff_request` 是資料庫 RPC（Stored Procedure），不是 Edge Function**——它會隨 `pg_dump`（`01_schema.sql`）完整倒出，**不要去 Dashboard 的 Edge Functions 頁找它**（那裡沒有，會白卡）。唯一的 Edge Function 是 **`trigger-task-engine`**，那支才要從 Dashboard/CLI 撈原始碼。
- ⚠️ **DevOps 交代：Supabase 輔助功能（trigger/view/Realtime/Edge Function/Storage/同專案其他排程/webhook）務必盤點乾淨、不可漏。**
- ⭐ **指南第 9 項**：找「哪些 function/trigger 會寫 `notification_log`（＝會發通知）」，特別標換班/請假/核准等**事件型通知**。**只搜字樣不足以下定論——不確定就標「待 RD 確認」，別當成結論。**
- 🔒 **含個資/憑證的匯出物（`08_data.sql` 等）不要進版控**，交 RD 另存；只有 schema/function/policy 這類技術定義可入 repo。
- G0 是 **② 重構的前置**——**盡快、最高優先**，重構全靠它。匯出完＝交 RD 接手做 ②，**這個 session 到此為止、不要自己往下做重構**。

## 重構（②）時的既定決策（勿再問，做法依 G0 定）

- 去 Supabase Realtime → 前端**輪詢**。
- 班表播報 → 移上班時段。
- 通知 → 讀 code 已確認：`notification_log` 佇列+無腦沖、時區為 **display 端轉換**、廣播非 ping → **寬工作窗 dispatch**（非 per-時區 24h）；事件型通知待 G0。
- 員工核准 → **後端通用核准 endpoint**（確認**無 Slack 核准按鈕**、非 webhook）；**邏輯直接對照 `01_schema.sql` 裡的 `approve_staff_request` RPC**（不必另去 Edge Functions 找）。
- 去 Supabase Auth → Google OAuth + 自管 JWT。**後端不走 FastAPI**；資料層改本機/RDS Postgres、做法依 dump 定。

## 近期重構完成驗收條件（②③④ 做完、進 ⑤ UAT 前，逐項對過才算完）

**這是本機重構範圍的「完成定義」。做完 ②③④ 後、交 Cathy 做 ⑤ UAT 之前，先自己把下面每一項對過並留紀錄**——別只跑得起來就宣稱完成。有一項對不上就標「待 RD 確認」，不要靜默放行。

1. **去 Supabase 盤點乾淨**：G0 匯出的每個 Supabase 輔助功能（trigger / view / Realtime / Edge Function / Storage / webhook / 同專案其他排程）都在新實作找得到對應，或明確記錄「不需要、原因是…」。**漏一個 = 少一塊安靜出錯**。
2. **核心後端邏輯重建**：唯一的 Edge Function `trigger-task-engine`、以及 DB RPC `approve_staff_request`（在 `01_schema.sql`），邏輯都在新後端有對應 endpoint，同輸入同輸出。
3. **事件型通知不漏**：G0 標出「會寫 `notification_log`」的換班/請假/核准等事件，新實作該發的都有發。
4. **關鍵表 row-count 對數**：用 G0 第 9 項的 dump，遷移後關鍵表筆數與原 Supabase 一致；不一致要能解釋。
5. **行為對數**：每個搬過來的 endpoint 與原 Supabase 同輸入同輸出（plan「每搬一塊行為對數一致」）。
6. **本機能一鍵跑**：`docker-compose up` 起得來、灌 sample data 後 `uat-checklist-cathy.md` 全項可跑。

> **不在近期範圍**：rollback drill、cutover 前後完整月週期對數是**日後 cutover** 才做（見 `plans` Phase 7）——現在別做，也別因為它沒做就卡住本機重構。

## 幾個一定要注意的（避免踩雷）

- **DB SSL**：內網不強制（`docs/vibe-cloud-ready-spec.md` 副本已同步上游 2026-09-08 修訂版：§4.5 已按 driver 區分，psycopg 用 `require`、`no-verify` 是 Node `pg` 系的值；文末有修訂紀錄）。
- **UAT（`docs/…/uat-checklist-cathy.md`）＝流程 ⑤**：在 **③④ 完成後的本機重構版 + sample data** 上驗，**安全、不碰正式 Supabase**（其內文若殘留「EKS/複本」等舊字樣以頂部 banner 為準）。**G0 期間不做 UAT。**
- `docs/` 下 design/plan 有大量**舊路線**（FastAPI/RDS/前後端分離/Phase 1–7 容器化現有版）——**已被 5 步流程取代**，別擷取局部就動手；工程片段可在 ② 複用。以各檔頂部 banner + 決策檔為準。

## 權威順序

1. `START-HERE.md` + 本檔 + `docs/superpowers/specs/2026-09-08-devops-sync-decisions.md`（**近期範圍的權威**）。
2. `docs/vibe-cloud-ready-spec.md` 是**日後上雲**的硬約束權威；其 RDS/應用層授權等**日後才適用**，不是本次改造指令。

## 規矩
- 一律**繁體中文**（程式碼/識別字/路徑/指令維持原文）。
- 改 `docs/superpowers/specs/` 或 `plans/` 下的檔，在 `docs/superpowers/specs/CHANGELOG.md` 記一筆。
- 發現文件自相矛盾，先在 CHANGELOG 提出再改，別靜默繞過。
