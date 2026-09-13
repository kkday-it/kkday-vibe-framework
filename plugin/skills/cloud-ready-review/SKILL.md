---
name: cloud-ready-review
description: 以公司內部 EKS 上雲規範（vibe-cloud-ready-spec）為尺，審查一個既有 app（尤其 Supabase / Vercel / Firebase 這類 PaaS-heavy、vibe-coded 的專案）對上雲的落差，產出排序過的 P0/P1/確認 findings + 三關 checklist + 平台待問清單 + HTML 報告。只要使用者提到「這個專案上雲要注意什麼」、「對照 cloud-ready spec 審一下」、「migration review / 遷移評估」、「這個 Supabase/Vercel app 搬到 EKS 有什麼坑」、給你一份工程師的架構評估要你複核、或給 repo/PDF 要你判斷上雲落差，就使用這個 skill——即使他們沒說「review」兩個字。先讀真 code 再對規範，別照工程師的二手描述設計。輸出一律附「這是哪條規範、在哪一節」。
compatibility: 需要能讀取目標 repo（本機或 gh clone）與 vibe-cloud-ready-spec 檔。產 HTML 報告時用純內嵌 HTML/CSS。
---
> 本 skill 唯一源在 `kkday-it/kkday-vibe-framework` 的 vibe-governance plugin;個人 ~/.claude/skills 下的散裝副本應移除。


# Cloud-Ready Review

把一個既有 app 對「公司內部 EKS 上雲規範」逐條比對，找出**上雲時會大改或安靜出錯**的地方，排序後交付。這是遷移前的第一步（評估），輸出決定要不要遷、遷的工作量、要先跟平台談什麼。

## 為什麼這樣做

vibe-coded / PaaS-heavy 的 app，最貴的問題不在程式碼裡，而在「它依賴了某個 PaaS 才有的能力」（BaaS auth、直連 DB、Realtime、平台 cron、平台 storage）。這些搬到 EKS 都要重寫。工程師自己寫的評估常**低估**這類（把「前端純靜態」當低風險，其實前端內含整個 BaaS client），或**漏掉**營運面（排程夜間縮容、對外 egress）。你的角色是獨立 REVIEWER：對規範、找落差、排風險，不是重寫方案。

## 權威規範

規範檔是 `vibe-cloud-ready-spec*.md`（版本以檔名日期為準，用最新的）。**開工先找它並讀完**：
```bash
find . -maxdepth 4 -iname 'vibe-cloud-ready-spec*.md' 2>/dev/null | sort | tail -1
```
找不到就問使用者要，或用他們指定的規範檔。所有 finding 都要對得上它的節次（如 §4.5、§4.7）。

## 工作流程

### 1. 先讀真 code，別只信二手描述
若使用者給了工程師的評估（PDF / md），把它當「待驗證的宣稱」，不是事實。**實際 clone / 讀 repo**，grep 出真實耦合點——這常消解假衝突、也抓出被低估的地方。至少確認：
- 前端怎麼碰後端：直連 DB？（grep `.from(` / `createClient` / SDK）有沒有自家 API 層？
- 認證：什麼機制（`signInWithOtp` / OAuth / magic link）？綁哪個 PaaS？
- 授權：靠 RLS / DB 規則，還是應用層？
- 背景邏輯：Edge Functions / DB function / trigger / 平台 cron——幾支、做什麼、打哪些外部 host、多久跑。
- 硬寫值：URL、金鑰、port、絕對路徑（grep）。

### 2. 元件分類
把每個元件歸三類（對應規範精神）：
- **需遷移（核心）**：PaaS 後端 / 前端託管 / 原始碼庫。
- **已是內部（確認連通即可）**：公司內部系統。
- **外部唯讀依賴（確認 egress）**：外部 API、CDN——上雲後內網要開白名單才連得出去，這常被當小事，其實是 gate。

### 3. 逐條對規範、排 finding
對照規範每一條，標出落差。每個 finding：
- **嚴重度**：`P0`（承重、被低估或漏、卡住整案）/ `P1`（要處理但範圍清楚）/ `確認`（判斷大致正確、低風險）。
- **對比工程師說法**（若有）：他說什麼 → 為什麼低估/漏 → 規範哪條。
- 常見高風險 pattern（幾乎每案都要查）：
  - **有沒有後端應用層**？PaaS 同時當 auth+data API+authz 的話，搬掉＝要新建一個後端服務（最大工作量，最常被當「低」）。
  - **授權綁 PaaS auth**（RLS 引用 `auth.uid()`）→ 不能隨 schema 移植，要重寫進應用層。
  - **商業邏輯在 DB function / trigger**（沒進版控）→ 要出土。
  - **排程**：in-process timer？平台 cron？**有沒有 24/7 不能中斷的排程**（災害/告警）與「夜間縮容」衝突（規範例外，要先跟平台談）。
  - **算力可能不在 PaaS**：真正的引擎/排程常在 PaaS 之外——外部 CI（GitHub Actions 等）、DB 內 pg_cron、DB function on cron。只盤 PaaS 會整塊漏掉「去 PaaS 化」的工作量。去看 repo 的 `.github/workflows/`、pg_cron、外部排程有沒有在打這個 DB。順帶查這些外部處存的憑證（service_role key、bot token、PAT）與所有權（個人帳號 vs org）——常是安全 finding。
  - **對外 egress**：內網叢集連不連得到那些外部 host。
  - **個資 / 憑證**：硬寫金鑰、log/產出含個資。

### 4. 三關 checklist + 平台待問
- 用規範的「三關」結構（第一關本機化 / 第二關叢集硬約束 / 第三關平台介接）列出這案要做的事。
- 列出**最先要跟平台/業務確認的問題**（沒答案前某些線不能動手的那種），排序。

### 5. 輸出 HTML 報告
產一份自包含 HTML（純內嵌 CSS，可離線開、可轉傳）。**設計前先載 `artifact-design` skill**。結構固定：
1. 一句話結論 + 3 個承重風險（先摘要後細節）
2. 發現排序（P0 先，每條含「工程師說法 vs 規範」對比）
3. 逐元件 × 規範對照表（含評級 pill）
4. 專案形狀（A 型服務 / B 型批次逐 workload 判）
5. 三關落地清單
6. 最先要問平台/業務的 N 件事
> 🔒 報告不含個資、憑證、原始資料列（要能轉傳）。findings 用嚴重度色條/pill 讓風險一眼可見。

## 交接
review 完若決定要遷 → 用 `paas-migration-handoff` 生交接包；G0 盤點用 `supabase-inventory`。三者串成：**評估 →（決定遷）→ 生交接包 → G0 盤點**。

## 分寸
- 只點風險與落差，不重寫方案（那是下游）。
- 手上沒有的料（function body、RLS 內容）→ 明講「尚未取得，是坐實 P0 所需的下一手資料」，別瞎猜。
- 規範自己有的判斷（A/B 型、image 能合就合、TLS 內網非硬性）照它走，別自創。
