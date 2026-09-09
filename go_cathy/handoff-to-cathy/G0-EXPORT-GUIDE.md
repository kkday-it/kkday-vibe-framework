# G0：Supabase 匯出指南（Cathy 的主要任務）

> **你的角色**：把 Supabase 專案裡的東西**完整匯出**成檔案，交給 RD。
> **為什麼最急**：下一步「照規範重構（去 Supabase）」**完全卡在這份匯出**——RD 要先看懂 Supabase 做了哪些事，才能重建。**這是整個流程的第一步、最高優先。**
> **怎麼做**：你不用自己寫指令——**把這份檔案交給你的 Claude Desktop，叫它「照 G0-EXPORT-GUIDE 幫我一步步匯出」**。你只要提供 Supabase 的存取權（下方）。
> **DevOps 主管特別交代**：Supabase 常有很多**輔助功能**（trigger、view、Realtime、Edge Function、Storage…），**務必盤點乾淨、不要漏**。漏一個，重構時就會「少一塊、安靜出錯」。

---

## 你要先準備的存取權（給 Claude / RD）

1. **資料庫連線字串**：Supabase Dashboard → **Project Settings → Database → Connection string**（`postgresql://...`）。這把鑰匙能匯出 schema / function / RLS / trigger / view / 資料。
   > ⚠️ **選對連線模式（很重要）**：請選 **Session pooler** 或 **Direct connection**（**Port 5432**），**不要選 Transaction pooler（Port 6543）**——後者有 prepared statement / pooler 限制，`pg_dump` 會直接噴錯。
   > 🆘 **若終端機顯示 `command not found: pg_dump`**：不用慌，你（Cathy）電腦沒裝很正常。把連線字串交給 Lance / RD 代跑 `pg_dump` 那兩項（第 1、8 項）即可；其餘 Dashboard / SQL 項目繼續由你 / Claude 進行。
2. **Dashboard 登入**：有些東西不在資料庫裡，要從畫面匯出（Edge Function 原始碼、Auth 設定、Storage、Realtime 開關）。
3.（選）**Supabase CLI** 已登入：`supabase login` + `supabase link`，能更快下載 Edge Functions。

> 🔒 匯出物**含員工個資**——存在本機、交給 RD，**不要上傳到公開的地方**。

---

## 主路徑（優先）：跑 `supabase-inventory` skill 自動盤點

**能跑 skill 就別手動。** 交接包內附 `supabase-inventory.skill`——一個只讀、fail-closed 的自動盤點工具，一鍵產出帶「來源」的 `manifest.json`，涵蓋下面手動 9 樣的**全部**，還多做 code-scan 交叉檢查（哪些表/RPC 有引用沒定義、RLS 沒開、service_role 外洩…）。**Cathy 用她 desktop 的 Claude Code 就能跑**（desktop 版 Claude Code 能開終端、跑 skill、讀 `CLAUDE.md`；**憑證全程留在她自己機器、不外流**）；RD 端有 coding agent 也可跑。

- **三樣存取**（Cathy 只在自己機器上交給自己的 Claude Code，不外傳）：① 專案 ref（Dashboard URL 那段 20 碼）、② Personal access token（Dashboard → Account → Access Tokens，`sbp_` 開頭）、③ DB 連線字串（**Session pooler，Port 5432**）。
- 跑（Cathy 的 Claude Code 或 RD coding agent 皆可）：
  ```bash
  export SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... SUPABASE_DB_URL='postgresql://...'
  CODE_DIR=<repo> bash <解開的 skill>/scripts/collect_supabase.sh 2>&1 | tee supabase-inventory/collect.log
  ```
- 🔎 **全程留痕（回應「怕 skill 還不完善」）**：每個查詢寫 `raw/db/<name>.json` **＋同名 `.err`**；每支 API 的 HTTP status 進 `raw/api/_status.tsv`；`manifest.json` 每欄都帶 `source` 指回原始輸出。
  > ⚠️ **信 manifest 前，先看 `raw/**/*.err` 與 `raw/api/_status.tsv`**：查詢失敗會在 manifest 變成空陣列 `[]`（看起來像「沒這功能」），只有 `.err` 會告訴你「是查失敗、不是沒有」。階段訊息走 stderr → 上面的 `| tee collect.log` 才會留下 console log。
- **skill 跑不動 / 不熟 Claude Code** → 走下面的**手動 Dashboard 路徑**（純 Dashboard 點按、不用終端）。**兩條路產物等價**，交件擇一即可。

---

## 手動 Dashboard 路徑（備援：skill 跑不動 / 不用 Claude Code 時；存進 `supabase-export/`）

> 這條路**不需要終端機**：AI 給你 SQL，你貼到 Supabase Dashboard 的 **SQL Editor** 跑、下載 CSV；Edge Function / Auth / Storage 在畫面上複製/截圖。憑證只在你自己的 Dashboard / 你的 Claude，不外流。

> 💡 **下面的 SQL 查詢（第 2、3、4、8、9 項）都可以不開終端機**：直接在 Supabase Dashboard 左側點 **SQL Editor → New query**，貼上執行，再點右上角把結果下載成 CSV 即可。只有 `pg_dump`（第 1、8 項）需要終端機。

### 1. 完整 schema（一次拿到 table + function + RLS + trigger + view）
一條指令就涵蓋大部分：
```bash
pg_dump --schema-only --no-owner --no-privileges \
  "<連線字串>" > supabase-export/01_schema.sql
```
> `--schema-only` 會一起匯出：table 結構、index、sequence、**所有 function（含 `fn_scan_*`、`fn_get_engine_*`）**、**trigger**、**view**、**RLS policy**。這是最重要的一份。

### 2. RPC function 清單（對照確認沒漏）
```sql
select routine_name
from information_schema.routines
where routine_schema = 'public' and routine_type = 'FUNCTION'
order by routine_name;
```
確認 01_schema.sql 裡有這些 function 的定義（尤其 `fn_scan_c4/f1a/f1b/publish`、`fn_org_family`、`fn_get_task_fairness`）。存成 `02_function_list.txt`。

### 3. RLS policies（授權規則，單獨再撈一份對照）
```sql
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```
存 `03_rls_policies.txt`。（01_schema.sql 也會有 `CREATE POLICY`，這份是好讀的對照。）

### 4. Realtime 開了哪些表（即時推播的範圍）
```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```
存 `04_realtime_tables.txt`。→ 決定上雲後前端要輪詢哪幾支。

### 5. Edge Functions 原始碼（code 不在 repo）
> ✅ **重要更正**：經查原生前端 code，`approve_staff_request` **其實是資料庫 RPC（Stored Procedure），不是 Edge Function**——它已包含在第 1 項的 `01_schema.sql` 裡，**不用**在 Edge Functions 頁面找它（找不到是正常的，別卡在這）。真正需要從 Dashboard 撈的 Edge Function 只有 **`trigger-task-engine`**。
- Dashboard → **Edge Functions**，把 `trigger-task-engine` 的原始碼複製出來；或 CLI：
```bash
supabase functions download trigger-task-engine
# 列出全部，確認有沒有預期外的第二支自訂 function（理論上只有 trigger-task-engine）：
supabase functions list
```
- 存進 `supabase-export/edge-functions/`。若 `supabase functions list` 列出預期外的其他 function，一併下載並記一筆。

### 6. Auth 設定（登入方式，不在資料庫裡）
Dashboard → **Authentication → Providers / Settings**：把「用哪種登入（magic-link）、email 網域限制（@kkday.com）、session 設定」截圖或記成 `05_auth_settings.md`。

### 7. Storage buckets（有沒有存檔案）
Dashboard → **Storage**：列出所有 bucket 名稱與存取政策；記成 `06_storage.md`。（若一個都沒有，寫「無」也要寫。）

### 8. 各表資料量 + 資料 dump（給上雲後對數用）
```sql
-- 各表筆數（快速估算，n_live_tup 是統計估計值、非精確）
select relname as table_name, n_live_tup as approx_rows
from pg_stat_user_tables order by n_live_tup desc;
```
> ⚠️ `n_live_tup` 是**估算值**，不能當精確對數依據。要精確筆數，對關鍵表逐張 `select count(*) from <table>;`。存 `07_row_counts.txt`。

資料本體（**含員工個資，特別小心**）：
```bash
pg_dump --data-only --no-owner "<連線字串>" > supabase-export/08_data.sql
```
🔒 **`08_data.sql` 含個資/憑證——不要進版控（git）**，只交 RD 另存於安全位置。

### 9. ⭐ 特別任務：確認「哪些動作會自動發通知」
上雲要處理通知的排程，**必須知道除了每日排程外，還有沒有『員工一按就即時發通知』的**（例如換班、請假申請/核准）。跑這兩段找出來：
```sql
-- 哪些 function 會寫入 notification_log（＝會發通知）
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_definition ilike '%notification_log%';

-- 哪些 trigger 掛在哪些表上（＝某動作自動觸發）
select event_object_table as table_name, trigger_name, event_manipulation, action_timing
from information_schema.triggers
where trigger_schema='public'
order by table_name;
```
> 🔧 **若第一段查詢 `routine_definition` 回傳空白**：通常是**權限問題**——非 superuser 帳號查 `information_schema.routines.routine_definition` 會看不到內容。改用 `pg_proc`：
> ```sql
> select proname from pg_proc join pg_namespace on pg_proc.pronamespace = pg_namespace.oid where nspname = 'public' and prosrc ilike '%notification_log%';
> ```
把結果存 `09_notification_triggers.txt`，**特別標出「跟換班/請假/核准有關、會發通知」的那幾個**。
> ⚠️ **只搜 `notification_log` 字樣不足以下定論**（可能透過中間層、或別的表名）。查到就列；**查不到不代表沒有** → 標「**待 RD 確認**」，別當成「無事件型通知」的結論。

---

## 交出去前，自己驗一下（Claude 可代跑）

- `01_schema.sql` 在空本機 Postgres 重跑，儘量無錯建出結構。
  > ⚠️ 若報錯，先看是不是缺 **role / extension / Supabase 專屬相依**（如 `auth`、`storage` schema、`pgcrypto` 等）——**還原失敗不一定代表 Cathy 匯出不完整**，把錯誤原樣記下交 RD 判斷。
- 對照 `02_function_list.txt`：每支 function 在 01_schema.sql 都找得到。
- Edge Functions 資料夾裡有 `trigger-task-engine`（唯一的 Edge Function）。
- `01_schema.sql` 或 `02_function_list.txt` 裡找得到 `approve_staff_request`（它是 DB RPC，不在 Edge Functions 資料夾）。
- `09_notification_triggers.txt` 有結論或標「待 RD 確認」。

## 交件邊界（重要）
- **交給誰**：RD（Lance 會指定接收人與存放位置）。
- **交什麼**：`supabase-export/` 整包。**含個資的 `08_data.sql` 走安全通道、不進 repo**；schema/function/policy 這類技術定義可入 repo。
- **留一份 log（供事後 retro）**：把過程存成 `supabase-export/export-log.md`（skill 路徑則是 `collect.log` + `raw/**/*.err` + `_status.tsv`）——匯出日期、Supabase 專案識別、每項「成功/失敗/不存在」、失敗的原始錯誤。**不要只留結論**。
- **G0 完成 = 交 RD 接手做 ② 重構**。這個 session（Cathy 的 G0）匯出完就交件，**不要**自己往下做重構/資料庫遷移——那是 RD 的下一步。

## 交付清單（給 RD）
```
supabase-export/
├── 01_schema.sql            表/function/RLS/trigger/view
├── 02_function_list.txt
├── 03_rls_policies.txt
├── 04_realtime_tables.txt
├── 05_auth_settings.md
├── 06_storage.md
├── 07_row_counts.txt
├── 08_data.sql              （含個資，小心保管）
├── 09_notification_triggers.txt
└── edge-functions/          trigger-task-engine（唯一 Edge Function；approve_staff_request 是 DB RPC，見 01_schema.sql）
```

這份匯出是**日後**去 Supabase 化 / 重建的備料。**有任何一項卡住或看不懂，記下來問 Lance / RD。**
