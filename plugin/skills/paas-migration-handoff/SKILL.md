---
name: paas-migration-handoff
description: 為「非工程背景的負責人（PM）」生成一份可執行的上雲遷移交接包——讓他的 AI 能照著做 Supabase/PaaS 盤點（G0）、產出去個資的完成報告、並照公司 DevOps 規範起手重構。只要使用者提到「幫某某（PM）做遷移交接包」、「把這個 vibe app 交給 PM 執行上雲」、「Migration Kit」、「handoff 給 Cathy/PM 做 G0」、「生一包讓非工程師能跑 Supabase 匯出」、「Round 2 / 補資訊讓重構一次到位」、「PM 本機 pg_dump / 採集含個資資料」、「開工前 preflight 閘門」、或已 review 完一個 PaaS app 要進遷移執行階段，就使用這個 skill。產出一整個 handoff 資料夾（START-HERE / G0-EXPORT-GUIDE / CLAUDE.md / docs/）並打包成 zip；Round 2 另附本機採集腳本 + fail-closed preflight。內建非工程可讀性規則與個資/憑證安全邊界。
compatibility: 需要能寫檔與 zip。搭配 supabase-inventory（G0 執行）與 cloud-ready-review（前置評估）使用。
---
> 本 skill 唯一源在 `kkday-it/kkday-vibe-framework` 的 vibe-governance plugin;個人 ~/.claude/skills 下的散裝副本應移除。


# PaaS Migration Handoff（Migration Kit）

把「一個 PaaS-heavy app 要上雲」變成一包**非工程 PM 能拿去執行**的交接資料。核心讀者有兩種，交接包要同時服務：
- **PM 本人**（非工程）：看懂「我這次要幹嘛、要準備什麼存取權、哪幾步是我要在畫面上點的、匯出後把什麼轉給誰」。
- **PM 的 AI**（實際執行者）：知道「① 要補足哪些資訊 ② 然後照公司 DevOps 規範起手重構」。

## 為什麼這樣做

遷移的第一步 G0（把 PaaS 後端盤點/匯出）卡住整個重構——但這步需要 PaaS 存取，只有 PM 有。所以要把它變成 PM 的 AI 能自動跑、PM 只提供存取與點畫面的形式。做壞的交接包會：混用工具名讓 PM 不知開哪個軟體、把技術除錯步驟塞給 PM 讓他恐慌、或引導把含個資的匯出丟到分享連結。這個 skill 把兩案踩過的坑固化成規則。

## 產出結構（固定）

```
handoff-to-<pm>/
├── START-HERE.md          給 PM 本人讀（白話、先講結論、只讀這份）
├── G0-EXPORT-GUIDE.md     PM 的 AI 執行的主線（盤點/匯出步驟）
├── CLAUDE.md              PM 的 AI 的規則書（流程、決策、驗收、留痕）
└── docs/                  給 AI / RD 看（PM 不用逐份讀）
    ├── <cloud-ready-spec>.md        公司 DevOps 規範「副本」（必附，重構照它）
    ├── solution-overview.md         這案的完整解法與重構計畫
    ├── g0-report-template.html      G0 完成報告模板（去個資、可轉傳）
    └── <review>.html                前置 cloud-ready-review 的報告（若有）
```

用 `assets/` 裡的骨架起手，逐案填內容。**規範一定要「附副本進包」**——只用引用的話 PM 的 AI 讀不到、就無法「照現有規範重構」。

## 工作流程

### 1. 收集這案的事實（別憑空填）
- 目標 repo（實讀，不靠二手描述）、PaaS 專案 ref、前端耦合形狀、認證機制、背景服務清單（幾支、做什麼、打哪些外部 host、頻率）、個資落在哪張表。
- 若已跑過 `cloud-ready-review`，直接拿它的 findings；把 review HTML 放進 `docs/`。
- **承重決策先確認**（沒定好整包會重寫）：平台面（24/7 排程能不能不被夜間縮容砍、egress 白名單可不可行）、業務面（認證換成什麼、cutover 容忍度）。用散文問，別急著填細節。

### 2. 套骨架、填內容
從 `assets/*.tmpl` 複製四個檔，把 `{{...}}` 換成這案的值。既定決策（去 PaaS auth→自管 OAuth+JWT、Realtime→輪詢、排程→CronJob、一個 compose、不拆前後端、不用 FastAPI、資料層→Postgres/RDS）當**預設**寫進 CLAUDE.md，除非這案有理由改。

### 3. G0 走 script 化 + 非工程可讀性（見 `references/readability-and-security.md` 與 `collection-and-preflight-hardening.md`）
- **G0 主路徑＝一支腳本**：用 `assets/g0-export.sh.tmpl` 把 DB 匯出全包，PM 只做「`cp .env.example .env` 填 3 格 → 叫 AI 跑 `./g0-export.sh` 一支」。**別寫成「AI 逐條下十個指令」**——執行者常是聊天版/桌面版 Claude Code、盡量少碰 terminal。Dashboard 只補畫面設定類（Auth/Storage/edge 摘要）。
- **別叫 PM 判「我是哪個版本的 Claude」**：寫「桌面版 App 或終端機都行、跑指令會請你核准」；備援（SQL Editor / RD 代跑）觸發條件寫「指令跑不動」而非「你版本錯」。
- 技術指令（SQL/pg_dump/port）**保留給 AI**，但配一句白話給 PM；驗證/除錯段標「這段給 AI/RD，PM 不用跑、看到紅字不用慌」。

### 4. 套安全邊界（見 `references/readability-and-security.md`）
- 🔒 含個資的匯出物（資料 dump）**不進版控、走安全通道另交 RD**。
- 連線字串/token **只在 PM 機器上給他的 AI 用**；某工具缺要 RD 代跑時走安全管道（當面/私訊，別貼公開頻道）。
- **完成報告可轉傳的前提**＝只含狀態+結構摘要+數字，**禁**資料列/個資/憑證/webhook URL/API key。

### 5. 收尾：報告 + 起手重構
G0-EXPORT-GUIDE 末尾一定要有兩步：
1. 用 `g0-report-template.html` 產 `g0-report.html`（去個資）→ PM 轉傳給主導者（這就是「公開公正、看得見」的進度）。報告用「預期（來自評估文件） vs 實際（G0 撈到）」對照，讓人一眼看出現實跟評估合不合。
2. 起手重構準備：照 `docs/` 內的規範副本，**第一關（本機化）不需等任何人立刻開始**，碰 PaaS 邏輯的用 G0 出土的料照既定決策做。

### 6. 打包
```bash
zip -rq handoff-<pm>-<date>.zip handoff-to-<pm> \
  -x '*.DS_Store' -x '*/.env' -x '*/supabase-export/*' -x '*/.pgpass' -x '*/g0-report.html'
```
打包後解開掃一次：無真 `.env`、無憑證值（`eyJ…`/`xox`/`ghp_`/`…supabase.co` 連線字串）、無個資 dump。
打包前 grep 檢查：無舊硬停殘留、工具名一致、報告模板的個資禁令在位。

## Round 2：G0 之後補缺口 + 自動接續重構

G0 撈得再完整，重構前常還缺三類東西；補齊才能讓 PM 的 AI **一次到位（自動重構 → 本機 UAT → PR），不用中途回頭問**。這是第二次交接（Round 2），跟 G0（Round 1）分開。

**做法**：三類缺口按 A（工程判斷，AI 讀 code 決定）/ B（認證，照公司 SSO 規範）/ C（DB 直連才拿得到的，PM 本機跑腳本、產物留本機）分工——**別把工程判斷丟給非工程 PM**。C 段用 `assets/collect-round2.sh.tmpl` 採集（真 `pg_dump` + 含個資資料 + 精確筆數，全留 PM 的 Mac、不回傳，只有聚合筆數進報告）。重構「開工前」用 `assets/preflight.sh.tmpl` 當 fail-closed 閘門（釘死目標 repo、掃漏貼金鑰、確認 C 段產物齊全）。重構規格與驗收（含 auth-context shim、153 函式驗收策略、本機 UAT gate）寫進 `AFTER-G0-AUTO-REFACTOR.md`。

**這兩支腳本是一個真案磨了 11 輪三方對抗式審查才收斂的硬化版**——複用時只改 `{{TARGET_REPO_SLUG}}` / `{{APP}}` placeholder，其餘 fail-open 防線（`grep -E` 非 `-q`、`git diff` 出錯 fail-closed、realpath 打穿 symlink、bash 3.2 `${var}`、origin 精確 allowlist、PGPASSFILE 不進 argv、base branch main/master fallback）**照抄別改回去**。細節與驗收方式見 `references/collection-and-preflight-hardening.md`（動這兩支腳本或跑多審者驗收前必讀）。

## 交接鏈
`cloud-ready-review`（評估）→ 本 skill（生交接包：Round 1 G0，必要時 Round 2 補缺口）→ 包內 `supabase-inventory`（G0 執行）。

## 檔案
- **Round 1（G0）**：`assets/START-HERE.md.tmpl`、`G0-EXPORT-GUIDE.md.tmpl`、`CLAUDE.md.tmpl`、`solution-overview.md.tmpl`、`g0-report-template.html` — 四份文件 + 報告骨架；**`g0-export.sh.tmpl`（G0 一鍵匯出腳本，主路徑，硬化版）+ `env.example.tmpl`（連線 3 格）**——PM 填 .env 跑一支即可，少碰 terminal。
- **Round 2（補缺口 + 自動接續）**：`assets/collect-round2.sh.tmpl`（本機採集，硬化版）、`preflight.sh.tmpl`（fail-closed 閘門，硬化版）、`env.example.tmpl`、`AFTER-G0-AUTO-REFACTOR.md.tmpl`（重構規格/驗收）、`GAP-CHECKLIST.md.tmpl`（三類缺口）。後兩份 .md 是 go-scheduling 實案範本，複用時重寫內容、保留結構與安全機制。
- `references/readability-and-security.md` — 非工程可讀性規則 + 個資/憑證安全邊界（填每份檔前讀）。
- `references/collection-and-preflight-hardening.md` — Round 2 兩支腳本的 fail-open 防線與驗收方式 + 多審者驗收紀律（動腳本前必讀）。
