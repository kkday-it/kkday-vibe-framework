# kkday vibe coding 規範（vibe-governance plugin 注入）

公司治理已在場。權威規範：`kkday-it/kkday-vibe-framework` 的 `vibe-cloud-ready-spec-0913.md`（2026-09-13 修訂）。

**路由（遇到就用，不用問）**：
- 使用者要**起新專案／寫新工具** → 先跑 `vibe-governance:vibe-start`（三個白話問題，生出合規骨架）。
- 想知道**現有專案合不合規** → `vibe-governance:vibe-check`。
- **既有 PaaS 專案（Supabase/Vercel/Netlify…）要上雲** → `vibe-governance:cloud-ready-review`（審落差）→ `supabase-inventory`（盤點）→ `paas-migration-handoff`（產交接包）。

**兩條紅線（不分級、一律適用）**：
1. 帳密／token／key 不寫進 code、不貼進對話——一律走 env 或 vault 引用。
2. 客人個資不貼進對話、不寫進 log／通知。

**分級**：專案會碰公司系統、要排程自動跑、或會寫入外部系統 → 引導使用者跑 `vibe-start` 申報（產生 `PROJECT.yaml`）。有 `PROJECT.yaml` 的專案，收工時 guard 會自動檢查（紅燈要修完才能收工；green 級缺容器化檔案只提醒不擋）。
