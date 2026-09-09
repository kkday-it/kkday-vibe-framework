# 給 Cathy — 從這裡開始

## 一句話：你這次的任務

**盡快把 Supabase 現在做了哪些事「匯出」（G0）。** 這是最高優先——**整個重構都卡在它**：RD 要先看懂 Supabase 裡的邏輯（schema / 那些自動流程 / 通知 / 核准…），才能照公司規範把系統重建成不依賴 Supabase 的版本。

> 之後的流程：**① 你匯出（G0）→ ② RD 照規範重構（去 Supabase）→ ③ 本機 Docker 跑起來 → ④ 灌測試資料 → ⑤ 你 UAT 驗收**。你負責 ① 和 ⑤；② ③ ④ 是 AI／RD。**現行線上系統全程不動。**

---

## 誰做什麼（這是重點）

| | 需要**人**（你 / 相關人）做 | **AI 讀檔就能做**（Claude Desktop / RD 的 AI） |
|---|---|---|
| 1 | **提供 Supabase 存取**（連線字串 + Dashboard 登入 + access token）——只在你自己機器上給你的 Claude 用 | **照 `G0-EXPORT-GUIDE.md` 跑 `supabase-inventory` skill 自動匯出**（你 desktop 的 Claude Code 跑、留 log）；跑不動再走手動 Dashboard |
| 2 | **Dashboard 才能拿的**：Edge Function 原始碼（主要就 `trigger-task-engine` 一支）、Auth 設定、Storage —— 需要人點畫面/截圖 | **② 照規範重構**（去 Supabase、建符合規範版）＋ ③ 本機 compose 跑起來——RD 的 AI 做 |
| 3 | **⑤ UAT 驗收**（③④ 好了之後，在**本機**測試版驗；安全、不碰正式資料） | ④ 灌基本測試資料、讀懂現況、產交付物 |
| 4 | **補 2 個答案**（見下，② 重構時才需要） | — |

**你（人）真正要動的就左欄。** 這次最重要、最急＝**第 1 件：G0 匯出**（AI 幫你跑，你給存取）。

---

## 你的主線：Supabase 匯出（G0）— 最急

👉 **打開 `G0-EXPORT-GUIDE.md`，交給你 desktop 的 Claude Code，貼這句：**

> 「照 `G0-EXPORT-GUIDE.md` 幫我做 G0 盤點：**優先跑 `supabase-inventory` skill 自動匯出**，全程留 log；跑完先看 `raw/**/*.err` 再給我結果。要在 Dashboard 點畫面的地方教我怎麼點。**我的專案 ref、access token、DB 連線字串只在我這台機器上給你用、不外傳。**」

你只要：
- 手上備好 **專案 ref + access token + DB 連線字串 + Dashboard 登入**（指南開頭有列在哪拿）——🔒 **這些只在你自己機器上給你的 Claude 用，不用傳給 Lance 或任何人**。
- Claude Code 會自動跑盤點、留 log；要在畫面點/截圖的（Edge Function、Auth、Storage）它會教你在 Dashboard 上做。
- 匯出完，把 **結果檔**（`supabase-export/` 技術定義 + `manifest.json`）交給 RD——裡面不含你的登入/token。
- 🖥️ **用哪個**：desktop 的 **Claude Code**（能自動跑 skill、留 log）。**若你不熟或跑不動 → 改走手動 Dashboard 路徑**（AI 給你 SQL，你貼 Supabase SQL Editor 跑），指南裡有。

重點提醒（DevOps 主管交代）：**Supabase 常有很多輔助功能（trigger / view / Realtime / Edge Function / Storage），務必盤點乾淨、不要漏**——漏一個，重構時就會「少一塊、安靜出錯」。
> ✅ **一個常見誤會先講清楚**：`approve_staff_request`（員工核准）**是資料庫裡的 RPC，不是 Edge Function**——它會隨 schema 匯出（`01_schema.sql`），**不用**去 Edge Functions 頁面找它。真正要從 Dashboard 撈的 Edge Function 只有 **`trigger-task-engine`** 一支。

### 兩個答案（② 重構時才需要，現在可先想）
- **員工時區分布**：員工在哪些時區？（重構時設定通知時段要用）
- **切換上線視窗**：日後真正上線切換可接受停用多久？有沒有絕對不能停的日子（每月 25 號排班、月底公佈）？

---

## 新系統開在**新的 repo**（給你知道，不用你操作）

新系統開在**新 repo `kkday-it/kkday-vibe-go-scheduling`**，**不改**現在營運中的 `kkday-go-scheduling`。現行系統不動、平行進行。Claude Desktop 已透過 `CLAUDE.md` 知道。

---

## 資料夾裡有什麼

```
handoff-to-cathy/
├── START-HERE.md          ← 你正在讀這份（你只需要讀這份）
├── G0-EXPORT-GUIDE.md     ← 你的主要任務：交給 Claude 執行
├── CLAUDE.md              給 Claude Desktop 的規則（你不用讀，它自己讀）
└── docs/                  📎 RD / AI 按需查閱的完整背景（你不用逐份讀）
    ├── HANDOFF.md、vibe-cloud-ready-spec.md
    └── superpowers/ specs（落差/架構/決策）、plans（實作計畫）、qa（UAT，日後才用）
```

> `docs/` 是給 **RD 和 AI** 查的完整資料（含很多**已延後**的日後細節）。**你（Cathy）不用讀它**——你的主線就是 `START-HERE` + `G0-EXPORT-GUIDE`。

---

## 有問題找 Lance
技術實作、平台資源、遷移風險 → Lance。
你的角色：**Supabase 匯出（G0）＋ 日後的業務決策與 UAT**。實作不用你動手。
