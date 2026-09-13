# Vibe Governance Plugin v1（標準版）— Design

- 日期：2026-09-14
- 狀態：codex peer-review 完成（5H+4M+2L 全採納，見 CHANGELOG），可實作
- 來源決策（grill 定案）：Q1 單一終點線（migration 終點 = 綠地安檢門）；Q2 棕地混合分工（owner 自助盤點、RD 側重構、人工點=拍板/核准/UAT）；Q3 綠地分發走 plugin；Q4 v1 = 標準版（知識包 + scaffolder + Stop hook guard）。

## 1. 目標與非目標

**目標**：員工裝一次 plugin，之後在任何資料夾 vibe coding，公司規範自動在場——起手有 scaffolder 生合規骨架、收工有 guard 自動驗、遷移有現成 skill 可叫。治理靠機器預設，不靠員工記得。

**非目標（v2+，刻意不做）**：
- PreToolUse 逐動作攔截（誤擋調校成本高）。
- MCP 插座（ctx.* connector 化，依賴 R4/平台團隊）。
- touches 自動推斷（從 code 掃出 external_sites/pii 自動申報）。
- 強制安裝機制（v1 靠推廣，管理面之後談）。

**v1 紀律：只包不依賴任何外部團隊的東西**（同 spec 三關的「第一關」哲學）。

## 2. 放置與分發

- **位置**：`vibe-framework` repo 內 `plugin/` 子目錄（單一源頭，spec/guard/template 改版同 repo 同步）。
- **marketplace**：repo 根目錄 `.claude-plugin/marketplace.json`，source 必須寫 `"./plugin"`（相對路徑以 `./` 開頭）：

  ```json
  { "name": "kkday-vibe", "owner": {"name": "lance.chien"},
    "plugins": [{ "name": "vibe-governance", "source": "./plugin",
                  "description": "kkday vibe coding 治理：規範注入 + 起手 scaffolder + 收工 guard + 遷移 skills" }] }
  ```

- **安裝（兩步，不是一步）**：
  1. `/plugin marketplace add kkday-it/kkday-vibe-framework`
  2. `/plugin install vibe-governance@kkday-vibe`
- **更新**：spec/guard 改版 → bump `plugin.json` version → 使用者跑 marketplace update／plugin update 才會換版；**舊 cache 與進行中的 session 會繼續用舊版**（Claude Code 已知行為），v1 對策 = 發版通知附「請更新」，不假裝自動生效。
- **發版前驗證**：`claude plugin validate --strict`（或等價 CLI）過了才 commit。

## 3. 結構

```
plugin/
├── .claude-plugin/plugin.json      # name: vibe-governance, version, description
├── hooks/
│   ├── hooks.json                  # SessionStart + Stop 兩個 hook
│   ├── session-inject.sh           # SessionStart：注入公司段（讀 COMPANY.md）
│   ├── stop-guard.sh               # Stop：cwd 有 PROJECT.yaml 才跑 guard，否則靜默 exit 0
│   └── validate_project.py         # guard 副本（源 = vibe-project-template/scripts/guard/，發版時同步）
│                                   # ⚠️ guard 需新增 --project-root 參數：打包後 __file__ 在 plugin cache，
│                                   # 原本 parents[2] 推 ROOT 會指錯地方；hook 一律傳 $CLAUDE_PROJECT_DIR
├── COMPANY.md                      # SessionStart 注入的內容（≤15 行，見 §4）
└── skills/
    ├── vibe-start/SKILL.md         # 起手 scaffolder（見 §5）
    ├── vibe-check/SKILL.md         # 手動健檢：跑 guard + 對照 cloud-ready 三關
    ├── cloud-ready-review/         # 收編自 ~/.claude/skills（遷移落差審查）
    ├── supabase-inventory/         # 收編（G0 盤點）
    └── paas-migration-handoff/     # 收編（PM 交接包生成）
```

三個 migration skill **收編進 plugin 後，plugin 成為唯一源**。plugin skill 有 namespace（`vibe-governance:cloud-ready-review`），與個人版**不會自動覆蓋、會並存**——收編當下即刪除個人 `~/.claude/skills` 下的三份副本（目前只存在維護者一台機器，遷移成本為零）；日後若發現團隊有散裝副本，plugin 版 SKILL.md 開頭註明「本 skill 唯一源在 vibe-governance plugin」供辨識。

## 4. SessionStart 注入（COMPANY.md）

原則：**短**。只做路由，不搬規範本文（全文注入會吃掉每個 session 的 context，且多數 session 用不到）：

- 一句定位：公司 vibe coding 規範已在場，權威 spec 在 `kkday-it/kkday-vibe-framework`——**COMPANY.md 在 build 時釘死實際檔名與修訂日**（現為 `vibe-cloud-ready-spec-0913.md`，2026-09-13），不用日期萬用字元，發版 checklist 隨 spec 改版更新這行。
- 三條路由：起新專案 → `vibe-start`；健檢現有專案 → `vibe-check`；既有 PaaS 專案要上雲 → `cloud-ready-review`（→ `supabase-inventory` → `paas-migration-handoff`）。
- 兩條紅線（不分級一律適用）：帳密/token 不寫進 code 與對話；客人個資不貼進對話。
- 一句分級：碰公司系統/排程/寫入外部 → 跟 AI 說一聲，它會照 `vibe-start` 幫你申報分級。

## 5. `vibe-start`（scaffolder）行為

1. 問三個白話問題（一次一題）：
   - 這是**網頁/API**（要一直開著）還是**定時跑的批次**？→ `shape: web|job`
   - 會碰到**公司系統、客人資料、或外部網站**嗎？→ `touches.*` + `risk_tier`
   - 是**自己用**還是**給團隊用/要排程自動跑**？→ green（免 repo 流程）或 yellow+（走完整 template）
2. **三題之外的必填欄位不問、自動推導**：`id` = `<team>.<資料夾名>`（team 問不到就用 git config email 網域前綴或再問一句）、`owner` = `git config user.email` 帳號、`status: active`、`schedules: {}`（要排程才引導填）。
3. green（自己用、不碰敏感）→ 只生 `PROJECT.yaml`（最小申報）+ 提示兩條紅線，不強加 Dockerfile/compose。**guard 需配套分級**：Dockerfile／`.dockerignore`／compose.yml 缺失在 green 降為 warning、yellow+ 維持 error（見 §5.1 實作連動）。
4. yellow+ → 取 template 骨架，**來源釘版、fail-closed**：
   - clone `kkday-it/kkday-vibe-framework` 指定 **release tag**（plugin 內記錄配對 tag）到暫存目錄；
   - 驗證：clone exit code、必要檔案 manifest（PROJECT.yaml／Dockerfile／compose.yml／guard script）齊全；
   - 全過才 **atomic copy** 進目標資料夾；任何一步失敗 → **不留半成品**，輸出人工替代步驟（去 GitHub 頁面下載 tag 的 zip），不把 token 印進指令或 log。
   - 依答案填 `PROJECT.yaml`、依 shape 留 A 或 B 型 compose 段。
5. 生成後立即跑 guard（帶 `--project-root`），**綠燈才交付**；紅燈則自己修到綠（scaffold 產物不許帶紅燈出生）。

### 5.1 實作連動（template 側，同批交付）

- `validate_project.py`：新增 `--project-root`；cloud-ready 檔案檢查（Dockerfile／.dockerignore／compose.yml）依 `risk_tier` 分級（green=warning、yellow+=error）。
- `run.sh`：不帶參數改為**列出可跑 task 清單後 exit 0**（對齊 cloud-ready spec §1.4「不帶參數印工作清單，不要報錯」；現行是印 usage 後 exit 2，本來就跟 spec 矛盾）。

## 6. Stop hook（stop-guard.sh）行為

**定位（誠實邊界，比照 conformance-gate §4）**：plugin hook 是 **advisory 安全網**，不是強制閘門——使用者可以刪 `PROJECT.yaml`、可以中斷、Stop hook 連擋多次後 Claude Code 也會強制放行。**強制層永遠是 yellow+ 專案的 CI + branch protection**；hook 的價值是把 90% 的問題在寫的當下修掉，讓 CI 紅燈變罕見，不宣稱它擋得住蓄意繞過。

- 觸發：每次 Claude 要結束回合時；專案根目錄從 hook stdin 的 `cwd`／`$CLAUDE_PROJECT_DIR` 取得，傳給 guard 的 `--project-root`。
- **專案根無 `PROJECT.yaml` → 立即 `exit 0`，零輸出**——不干擾任何非 vibe 專案（這是不被使用者解除安裝的存活條件）。
- 有 `PROJECT.yaml`：
  1. 優先用專案自帶 `scripts/guard/validate_project.py`；沒有則用 plugin 內建副本（皆帶 `--project-root`）。
  2. guard 紅燈 → `exit 2` + stderr 列紅燈項（Claude 收到後修正才能收工）。
  3. guard 綠燈 → `exit 0`；**警告**走 stderr 一併輸出但 `exit 0`（明知 exit 0 的輸出多半只進 debug log——warning 的正式可見管道是 CI，這裡不假裝使用者看得到）。
- 防呆：python3 不存在或 guard 自身 crash → stderr 一行警告後 `exit 0`（**fail-open**——hook 故障不能癱瘓使用者；enforcement 在 CI）。

## 7. 驗收條件（每條：fixture → 指令 → 預期）

1. **非 vibe 資料夾靜默**：空資料夾 → 直接執行 `stop-guard.sh`（stdin 餵 `{"cwd":"<該資料夾>"}`）→ exit 0、stdout/stderr 皆空。
2. **紅燈擋收工**：template 專案複本刪 `compose.yml` → 執行 `stop-guard.sh` → exit 2、stderr 含「compose.yml」；還原後 → exit 0。
3. **scaffold 產物過 guard**：依 §5 生 web 與 job 兩個 fixture（含自動推導欄位）→ `validate_project.py --project-root <fixture>` → 兩者皆 `guard: PASS`；green fixture（僅 PROJECT.yaml）→ 無 error（Dockerfile/compose 缺失為 warning）。
4. **plugin 結構合法 + 可安裝**：`claude plugin validate`（或等價 `--strict`）通過；本機 `claude --plugin-dir` 或 marketplace add（本機路徑）→ `/plugin install vibe-governance@kkday-vibe` 成功、skills 以 `vibe-governance:` namespace 出現。
5. **收編唯一源**：個人 `~/.claude/skills` 三份副本已刪除；plugin 版 SKILL.md 首行含唯一源註記。
6. **SessionStart 成本**：`session-inject.sh` 輸出 ≤ 1,200 bytes、不含任何 secret；startup/resume/clear/compact 四種 source 輸出一致（無重複疊加邏輯）。
7. **更新相容（發版程序，非自動測試）**：發新版時 CHANGELOG 註明「舊 cache/舊 session 續用舊版，需 plugin update」；發版 checklist 含 guard 副本 diff 同步。

## 8. 風險與對策

| 風險 | 對策 |
|---|---|
| guard 副本與 template 版分岔 | 發版 checklist：bump version 前 `diff` 兩份 guard；列入 spec 版本 bump checklist（memory 已有制度） |
| Stop hook 誤擋非 vibe 專案 | §6 的「無 PROJECT.yaml 即靜默」是硬規則 + 驗收條件 1 |
| hook 故障癱瘓使用者 | fail-open（§6 防呆）；CI 仍是強制底線 |
| 收編後 skill 雙源分岔 | 收編即移除個人版；plugin 為唯一源 |
