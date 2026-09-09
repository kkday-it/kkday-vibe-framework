# 給 Cathy — 從這裡開始

## 一句話：你這次的任務

**盡快把 Supabase 現在做了哪些事「匯出」（G0）。** 這是最高優先——**整個重構都卡在它**：RD 要先看懂 Supabase 裡的邏輯（schema / 那些自動流程 / 通知 / 核准…），才能照公司規範把系統重建成不依賴 Supabase 的版本。

> 之後的流程：**① 你匯出（G0）→ ② RD 照規範重構（去 Supabase）→ ③ 本機 Docker 跑起來 → ④ 灌測試資料 → ⑤ 你 UAT 驗收**。你負責 ① 和 ⑤；② ③ ④ 是 AI／RD。**現行線上系統全程不動。**

---

## 誰做什麼（這是重點）

| | 需要**人**（你 / 相關人）做 | **AI 讀檔就能做**（Claude Desktop / RD 的 AI） |
|---|---|---|
| 1 | **提供 Supabase 存取**（連線字串 + Dashboard 登入）——鑰匙在人手上 | 拿到存取後，**照 `G0-EXPORT-GUIDE.md` 自動匯出** 9 樣（跑指令、SQL、存檔、驗證） |
| 2 | **Dashboard 才能拿的**：Edge Function 原始碼（主要就 `trigger-task-engine` 一支）、Auth 設定、Storage —— 需要人點畫面/截圖 | **② 照規範重構**（去 Supabase、建符合規範版）＋ ③ 本機 compose 跑起來——RD 的 AI 做 |
| 3 | **⑤ UAT 驗收**（③④ 好了之後，在**本機**測試版驗；安全、不碰正式資料） | ④ 灌基本測試資料、讀懂現況、產交付物 |
| 4 | **補 2 個答案**（見下，② 重構時才需要） | — |

**你（人）真正要動的就左欄。** 這次最重要、最急＝**第 1 件：G0 匯出**（AI 幫你跑，你給存取）。

---

## 你的主線：Supabase 匯出（G0）— 最急

👉 **打開 `G0-EXPORT-GUIDE.md`，交給你的 Claude Desktop，貼這句：**

> 「照 `G0-EXPORT-GUIDE.md` 一步步幫我從 Supabase 匯出；要在 Dashboard 點畫面的地方，告訴我怎麼點。我會提供專案 ref、access token、DB 連線字串。」

你只要：
- 提供 **Supabase 連線字串 + Dashboard 登入 + access token**（指南開頭有列在哪拿）。
- 遇到「要在畫面點/截圖」的（Edge Function、Auth、Storage），照 AI 指示操作。
- ⚙️ **自動盤點 skill 與後面的重構要用「能跑程式的 AI」**（RD 那邊的 Claude Code / coding agent）——聊天版 Claude Desktop 跑不了。你這關只要提供存取 + 照指示點 Dashboard 就好。

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
