# Claude Code 修正指示：kkday-go-scheduling 上雲交接包 (`handoff-to-cathy`)

本文件為交給 Claude Code 的指令指南，用來修正 `/Users/lance.chien/Documents/Projects/vibe-framework/go_cathy/handoff-to-cathy` 內的交接文件。

---

## 背景與修正目的

經對比原生專案 `/Users/lance.chien/Documents/Projects/vibe-framework/go_cathy/kkday-go-scheduling` 程式碼，發現交接文件中有 **1 個重大事實誤判** 與 **3 個實務操作漏洞** 需要修正：

1. **重大事實誤判（Edge Function vs RPC）**：
   - 文件多次要求 Cathy「去 Dashboard 撈 Edge Function `approve-staff-request` 原始碼，列為最高優先」。
   - **真相**：原生專案 `StaffRequests.jsx:176` 是呼叫 `supabase.rpc('approve_staff_request')`，說明文件亦載明為 RPC。它**不是** Edge Function，而是 PostgreSQL 內的 Stored Procedure。
   - **影響**：Cathy 在 Edge Functions 頁面會完全找不到它而卡住。它實際上會在 `pg_dump --schema-only`（`01_schema.sql`）被完整倒出。真正的 Edge Function 只有 `trigger-task-engine`（見 `dailyTasksApi.js:434`）。
2. **連線字串 Port 陷阱**：
   - Supabase 預設連線常為 Transaction Pooler (Port 6543)，若拿去跑 `pg_dump` 會噴錯（prepared statements / pooler 限制）。必須提醒使用 Session Pooler 或 Direct Connection（**Port 5432**）。
3. **終端機工具依賴備案**：
   - Cathy 為非工程背景 PM，電腦很可能沒有安裝 `pg_dump`。需提供替代方案：若提示 `command not found: pg_dump`，連線字串可交由 Lance/RD 代跑 dump。
   - SQL 查詢（2、3、4、8、9 項）應提醒可直接在 Supabase Dashboard 的「**SQL Editor**」貼上執行並匯出 CSV。
4. **`docs/HANDOFF.md` 內容矛盾清理**：
   - 開頭 Banner 已宣佈改採「5 步流程（G0 → 重構 → 本機 compose → 測試資料 → UAT），不做舊版容器化丟棄工」，但第 42~47 行卻仍殘留「線 A：Phase 1 容器化現有元件立即做」，產生自我矛盾，需予以清除或更新。

---

## 具體檔案修改清單

### 1. `START-HERE.md`

- **Line 16 表格第 2 項**：
  - 原文：`Dashboard 才能拿的：Edge Function 原始碼...`
  - 修改重點：註明 Edge Function 主要是 `trigger-task-engine`。
- **Line 30**：
  - 原文：`最優先 approve-staff-request 的原始碼（現在完全看不到）。`
  - 改為：澄清 `approve_staff_request` 其實是資料庫內的 RPC（Stored Procedure），會隨 `01_schema.sql` 一起匯出，無須在 Edge Functions 頁籤尋找；真正的 Edge Function 是 `trigger-task-engine`。
- **Line 53 備註**（若有）：確保概念一致。

---

### 2. `G0-EXPORT-GUIDE.md`

- **Line 12（連線字串說明）**：
  - 增加提示：Supabase Dashboard 的連線字串請務必選取 **Session pooler** 或 **Direct connection**（**Port 5432**），**不要選 Transaction pooler (Port 6543)**，否則 `pg_dump` 會因連線模式限制而失敗。
  - 增加防呆提醒：若終端機提示 `command not found: pg_dump`，不用慌張，可直接把連線字串交由 Lance / RD 代跑 dump，其餘 Dashboard 項目繼續由 Cathy / Claude 進行。
- **Line 31-56, 75-80, 88-105（SQL 查詢各項）**：
  - 增加一行操作小提示：「*💡 這些 SQL 也可以直接在 Supabase Dashboard 左側點選 **SQL Editor** → 新增查詢貼上執行，再點右上角下載 CSV 即可。*」
- **Line 57-65（第 5 項：Edge Functions 原始碼）**：
  - **重要更正**：說明經查驗原生前端 code，`approve_staff_request` 其實是資料庫 RPC，已包含在 `01_schema.sql` 中！
  - Dashboard 上的 Edge Functions 主要是 **`trigger-task-engine`**。
  - 將指令與說明聚焦於下載 `trigger-task-engine`，並用 `supabase functions list` 確認是否有其他自訂 function，避免 Cathy 找不到 `approve-staff-request` 而困惑。
- **Line 90-95（第 9 項：查詢 routine_definition）**：
  - 補充說明：若以非 superuser 帳號查詢 `information_schema.routines.routine_definition` 可能為空，可補充或替換為查詢 `pg_proc`：
    ```sql
    select proname from pg_proc join pg_namespace on pg_proc.pronamespace = pg_namespace.oid where nspname = 'public' and prosrc ilike '%notification_log%';
    ```
- **Line 112 & Line 133（自我驗證與交付清單）**：
  - 移除「Edge Functions 至少要有 `approve-staff-request`」的硬性要求，改為：
    - Edge Functions 確認有 `trigger-task-engine`。
    - `01_schema.sql` 或 `02_function_list.txt` 內能找到 `approve_staff_request`。

---

### 3. `CLAUDE.md`

- **Line 23**：
  - 原文：`- 最優先 approve-staff-request 原始碼（現在完全看不到）。`
  - 改為：澄清 `approve_staff_request` 是 DB RPC（在 `01_schema.sql` 中），Edge Function 為 `trigger-task-engine`。
- **Line 34**：
  - 原文：`- 員工核准 → 後端通用核准 endpoint（確認無 Slack 核准按鈕、非 webhook；邏輯待 G0）。`
  - 補充：邏輯直接對照 `01_schema.sql` 中的 `approve_staff_request` RPC。

---

### 4. `docs/HANDOFF.md`

- **Line 42~47（先做什麼）**：
  - 原文仍殘留：
    ```markdown
    ### 線 A：Phase 1（不卡任何前置，立即可做）
    容器化現有元件（batch 打包 + 前端 nginx + .env.example 補全 + README）...
    ### 線 B：G0 待盤點（Cathy 負責 dump，解鎖 Phase 2 以後）
    Phase 2 以後（全部延後）需先拿到 Supabase 內部；G0 是日後備料、與近期 Phase 1 並行、不阻擋 Phase 1。
    ```
  - **修改為**：移除「線 A / Phase 1 立即做」的矛盾陳述，完全對齊 2026-09-08 的 5 步流程：
    - 當前唯一線路就是 **① G0 Supabase dump（最高優先，Cathy 執行）**。
    - 取得 G0 資料後，由 RD 接手執行 **② 照規範重構（去 Supabase、單一 docker-compose）**。不做中間過渡的舊版容器化。
- **Line 56**：
  - 將「兩個 Edge Function 原始碼（`trigger-task-engine`、`approve-staff-request`...）」修正為「Edge Function 原始碼（`trigger-task-engine`；註：`approve_staff_request` 為 DB RPC，已在第 1/2 項涵蓋）」。

---

## 執行驗證

修改完成後請檢查：
1. 全資料夾搜尋 `approve-staff-request`，確認所有指稱皆已釐清其為「DB RPC `approve_staff_request`」，而非「不存在的 Edge Function」。
2. `HANDOFF.md` 內不再出現「Phase 1 與 G0 並行立即可做」的衝突語句。
3. `G0-EXPORT-GUIDE.md` 內已明確具備 Port 5432 與 SQL Editor 友善說明。
