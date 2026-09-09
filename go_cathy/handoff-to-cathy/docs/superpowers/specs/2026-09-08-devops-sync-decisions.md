# DevOps Sync 決議（2026-09-08）— 待併入 design/plan

> 與 DevOps 主管 / 規範作者 sync 的結果。**這些方向性決議推翻了部分先前架構決策**（前後端分離、FastAPI、夜間 CronJob）。
> **尚未織進 design/plan 本體**——避免在資料層方向確認前製造矛盾。確認後一次改乾淨（含 gap-report / design / plan / HANDOFF / DevOps-sync）。

## 7 條決議

| # | 決議 | 影響（推翻/調整了什麼） |
|---|---|---|
| 1 | **公司內網，不強制 SSL** | sslmode 爭議消失——不是筆誤之爭，是「內網不強制 TLS」。DB 連線可放寬（psycopg 若用 TLS 則 `require`，但非必須）。原 §4.5「TLS 必開」對此案不適用。 |
| 2 | **排程盡量排上班時段、避免夜間縮容** | 平台**不特別支援夜間 CronJob**。→ 但見下方「通知機制真相」，此案的通知需求其實塞得進工作窗，衝突比原本想的小。 |
| 3 | **不拆前後端 container，一個 docker-compose 起起來** | **推翻「選項 A 前後端分離、三 image」**。目標簡化為單一 compose。 |
| 4 | **後端跟 DB 不用 FastAPI** | **推翻「Python/FastAPI 後端」決策**。資料層改法待確認（見下方待決）。 |
| 5 | **GitHub cron → ArgoCD/GitOps，排程包進 image/repo** | 排程宣告隨 repo 走、ArgoCD 同步成 CronJob。對齊 framework R3。 |
| 6 | **Supabase 有很多輔助功能，務必讓 AI 盤點清楚** | **強化 G0**：schema/RPC/RLS/Realtime/Edge Fn/Storage/Auth/triggers/views/webhook 全數徹底盤點。**尤其：前端動作是否透過 RPC/trigger 即時塞通知**（見下方通知機制）。 |
| 7 | **目標就是 local 能 compose 起來** | 北極星＝第一關（本機 docker compose up）。EKS 優化的拆分/重寫**降級或延後**。 |

## 🔍 通知機制真相（2026-09-08 讀 code 得出）——把「跨時區 vs 上班時段」衝突縮小

**從 code 看到的實際運作：**
1. `notification_log` 是**佇列表**，**無 `send_at`/`scheduled_for`/`timezone` 欄位**。
2. `dispatch_notifications.py` 是**無腦沖佇列器**：每 5 分撈 `status=pending`、**全部立刻送**，**無任何時區/送出時間邏輯**。
3. 塞佇列者（＝真正決定「何時通知」）：`scheduling_engine`（每月 25 號）+ `fn_scan_*` 四支於**固定台北時間**（f1b 04:00 / c4 09:00 / publish 27 號 10:00 / f1a 20:00）+ **前端動作觸發的 RPC（換班/請假… → Supabase 黑盒，未確認）**。
4. **時區是 display 端處理**：i18n 明載「班表時間台北 UTC+8 輸入，系統自動轉各員工當地時間**顯示**（播報/今日工作/每日任務）」——不是送出端。
5. **04:00 播報**：刻意提早 buffer 掉延遲，讓訊息「早上上班前躺在群裡」；且 **f1b 無 `<!channel>` tag → 04:00 發不吵醒任何人**，各人自己時區早上打開才看到。

**結論：現況根本沒有「per-員工時區、24 小時按各自時間送」。** Cathy 的「跨時區、按時發送」真正需求＝**每人早上打開時，今日資訊「在的」且顯示他當地時間**——靠 display 轉換 + 早發非 ping 廣播達成，**不需 dispatch 24 小時跑**。

**務實解（取代原 A2/C1「要平台夜間支援」）：**
- dispatch 跑**較寬工作窗**（如台北 07:00–21:00），涵蓋所有 scan 時段。
- f1b 播報 04:00 → 移 ~07:00（非 ping、不影響）。
- 時區轉換維持現況（display 端，已做）。

## ⚠️ 仍要確認的（唯一真正可能需要 off-hours 的）

**前端動作（換班、請假申請/核准）會不會透過 RPC/trigger 即時塞通知、且對方在別時區需「立刻收到」？** 這段在 Supabase 黑盒（RPC/trigger），code 看不到 → **併入 G0（呼應決議 #6）**。若有，才需要 dispatch 覆蓋更廣時段或事件驅動送出。

## ✅ 資料層方向 — 已定案（2026-09-08）：5 步流程、去 Supabase

先前「選項 1 維持現況」被澄清：**不是「保留 Supabase 不改」，而是**——
> **① 盡快 G0 dump → ② 照 `vibe-cloud-ready-spec` 重構（去 Supabase）→ ③ 本機 compose 能動 → ④ 灌 sample data → ⑤ UAT（本機）。**

- **不做**「先把舊版容器化（維持 Supabase）」的丟棄步——一次建對的。
- **② 重構卡在 ① dump**；重構形狀＝不拆前後端、不用 FastAPI、一個 compose；資料層＝去 Supabase → 本機/日後 RDS Postgres，**具體做法依 dump 結果定**（非 FastAPI）。
- UAT（⑤）在本機重構版 + sample data 上做，**安全、不碰正式 Supabase**。

## 重寫時要動的檔（確認資料層後執行）

- design §0 決策表（移除/改 前後端分離、FastAPI、三 image；加 ArgoCD/GitOps、單 compose、SSL 放寬）、§1 拓撲、§2.4 資料層、§4 部署、§4.3 排程（通知寬工作窗）。
- plan Architecture / Global（SSL、排程）/ Phase 1（單 compose）/ Phase 3（不建 FastAPI）/ Phase 5（排程 ArgoCD + 通知寬工作窗）/ G0（強化盤點，含事件型通知）。
- gap-report 排程/通知段、待盤點強化。
- HANDOFF / DevOps-sync artifact 對齊。
