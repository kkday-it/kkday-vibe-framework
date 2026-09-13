# 產出「可轉傳的完成報告」（給非工程主導者看進度）

盤點完 `manifest.json` 是給 RD/AI 的技術檔。若主導者是非工程 PM、或要讓進度「看得見、可轉傳」，多產一份**去個資的 HTML 完成報告**。這是實案（打風政策系統）學到的：PM 親手轉交一份報告，比 AI 背著人自動送更清楚、也是留痕證據。

## 硬規則：可轉傳 = 去個資子集
報告**只能含狀態 + 結構摘要 + 數字**（表名、row counts、function 名、外部 host）。**禁**：資料列內容、任何個資、連線字串、token、webhook URL、API key。報告開頭放聲明「本報告僅含狀態與結構摘要，不含個資、憑證、原始資料列」——這句就是它能被轉傳的依據。**絕不要**把 `manifest.json` 原檔或資料 dump 直接當報告送出（manifest 可能含 secret 名稱、內部結構）。

## 結構（從 manifest 組，全部有 source）
1. **表頭**：專案 ref、匯出日期、執行者、總狀態一句話。
2. **完成度狀態表**：每個採集項目 ✅完成 / ⚠️部分 / ❌失敗 / ➖不存在 / ⏳待確認 + 來源。**照實標失敗與空的，別全綠**（`_status.tsv` 非 200、`.err` 非空都要反映）。
3. **系統盤點：預期 vs 實際**。若有工程師評估文件，把它當「預期」欄，manifest 當「實際」欄，對不上標差異（多/少一支 function、少一張表、`rls_disabled_tables`…）。這是核對現實與評估是否一致的關鍵。
4. **對外連線清單（egress）**：每支 edge function 打的外部 host（完整網址），給平台開白名單用。見下節怎麼抽。
5. **待確認 / 失敗**：`checks` 非空項、失敗查詢（原始錯誤，不含憑證）。
6. **交付與下一步**：匯出物檔名清單（含個資的註明走安全通道）、log 位置。

## 模板
`paas-migration-handoff` skill 的 `assets/g0-report-template.html` 是現成骨架（含上述結構、燈號樣式、去個資聲明）。沒有它就照上面結構產一份自包含 HTML（純內嵌 CSS，可離線開、可轉傳）。

## 手動路徑（無 pg_dump 時）最容易漏的四樣（實案踩過）

skill 的 `collect_supabase.sh` 走 `pg_dump` 不會漏這些；但若環境連不到 DB、改走 Dashboard/SQL 重建，務必單獨撈，否則「安靜出錯」：
- **enum 自訂型別 + sequence**：漏了還原時整批表建不起來（欄位 `DEFAULT nextval(...)` / enum 型別找不到）。
- **pg_cron 排程**（`select * from cron.job`）：DB 內定時業務邏輯，`--schema-only` 不含。
- **外部排程 / CI（PaaS 之外）**：算力常不在 PaaS 裡——查 repo `.github/workflows/`、其他 CI、外部 cron 有沒有在打這個 DB / 跑引擎。只盤 PaaS 會整塊漏。標進報告的「預期 vs 實際」與 egress 清單。
- **不要預設某 function/edge「不存在、不用找」**：先列真實清單再比對評估文件，以實際列出的為準。

## egress host 擷取（遷移必備，容易漏）
上雲後內網叢集要開白名單才連得到外部 API。從盤點結果抽出每支 edge function 打的外部 host：
- edge function 原始碼（腳本會下載到 `supabase/functions/`）grep 出 `fetch(` / `http(s)://` 的目的地。
- 對照 code-scan 的外部呼叫。
- 每支列：function 名 / 外部 host 完整網址 / 觸發頻率（`cron.job` 或 Dashboard schedule）。
排程頻率也一起抓——若某排程是「不可中斷」（災害/告警類），標明白，因為它與叢集「夜間縮容」會衝突，要先跟平台談。
