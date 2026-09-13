# 本機採集腳本的硬化規則（Round 1 G0 + Round 2 補資訊）

這份講 handoff 裡兩類本機腳本怎麼用、以及它們踩過的坑（真案磨了很多輪三方對抗式審查才收斂——別重推一遍，直接複用 `assets/` 裡的硬化版）。

## Round 1（G0）也走 script 化：`g0-export.sh`

**為什麼 script 化：** 執行者通常是**聊天版/桌面版 Claude Code、盡量少碰 terminal**（使用者定案，見 [[match-tool-to-operator-env-before-promoting]]）。所以 G0 別寫成「AI 逐條下十個指令」——包成**一支 `g0-export.sh`**，PM 只做「`cp .env.example .env` 填 3 格 → 叫 AI 跑一支」。少指令＝少失敗點。

`assets/g0-export.sh.tmpl` 一支把 DB 那部分全撈：schema（`-n public`）、function/RLS/realtime 清單、row counts、data dump（含個資、留本機）、notification triggers（帶 `action_statement`）、cron 排程（**只 `jobid,schedule,active`，不取 `command`**——command 常內嵌 service_role key）、edge functions（supabase CLI，沒有就導 Dashboard）。複用改的 placeholder：`{{PROJECT_REF}}`、`{{EDGE_FN_NAMES}}`、`{{EDGE_FN_COUNT}}`、`{{NOTIFY_LOG_TABLE}}`、`{{APP_NAME}}`。

**script 化 G0 特有、非工程 PM 友善的硬點（除了下面共通的 fail-open 那批）：**
- **連線走 `.env`→PGPASSFILE**：密碼不進 argv/env/**shell history**（PM 少碰 terminal，但殘留一樣危險）。
- **連線預檢 `psql -c 'select 1'` + `PGCONNECT_TIMEOUT=10`**：連不到 DB 就**立刻明確報錯 + 引導備援**，不要逐支指令卡在 TCP connect 像凍住（聊天版 Claude 連不到就該快速轉備援）。
- **`COLLECTION.COMPLETE` 只在關鍵產物齊全才寫、缺就 `exit≠0`**：dump/query 失敗不能被誤判成功；每支 `_psql_to`/pg_dump 開頭都 `rm -f` 舊檔（否則上一輪成功檔會被當本次成功）。
- **schema dump 也要掃憑證**（不只 edge function 原始碼）：`pg_dump --schema-only` 會把 public function body 撈出來，裡面可能硬編碼 webhook/key。
- **文件別叫 PM 判「我是哪個版本的 Claude」**：寫「桌面版 App 或終端機都行、跑指令會請你核准」；備援觸發條件寫「指令跑不動」而非「你版本錯」。Dashboard 只補畫面設定類（Auth/Storage/edge 摘要）。

## Round 2：本機採集 + fail-closed preflight

G0（Round 1）之後常還缺三類東西，要靠 Round 2 補齊，然後讓 PM 的 AI **自動接續重構 → 本機 UAT → PR**。

## 三類缺口與分工（寫進 GAP-CHECKLIST / START-HERE）

| 類別 | 誰做 | 為什麼 |
|---|---|---|
| **A. 工程判斷** | AI 讀 code 決定，別問 PM | 「這是刻意還是隨手」是工程題，丟給非工程 PM 只會卡住；AI 讀 source 就能定，記進決策檔 |
| **B. 認證** | 照公司 SSO 規範，別抄舊 PaaS auth | session/MFA/OAuth 由 RD 照公司規範設，不是複製舊設定 |
| **C. DB 直連才拿得到的** | PM 本機跑 `collect-round2.sh`，產物留本機 | 真 `pg_dump` + 含個資資料 + 精確筆數——雲端 session 連不到 DB，且不該把憑證貼上雲 |

**核心原則:C 段個資/憑證全程留 PM 的 Mac、不回傳。** 主導者只需要報告裡的「聚合筆數」（純數字），不需要資料本身。

## 兩支腳本（`assets/collect-round2.sh.tmpl`、`preflight.sh.tmpl`）

- **collect-round2.sh** — PM 本機採集：`pg_dump` schema+data（只 `-n public`）+ 單一 REPEATABLE READ 交易的精確 row counts。產物留本機專用夾（gitignore、chmod 700）。
- **preflight.sh** — 自動重構「開工前」的 fail-closed 閘門：釘死目標 repo、掃本次新增行有沒有漏貼金鑰、確認 C 段產物齊全，任一不過就 `exit≠0` 擋住自動流程。

複用時要改的 placeholder：`{{TARGET_REPO_SLUG}}`（org repo，如 `kkday-it/foo`）、`{{APP}}`（OUT_DIR 預設名）。其餘硬化邏輯**照抄別動**。

## 這些「fail-open / crash」坑一定要保住（每個都是真 bug，別改回去）

1. **secret scan 不能用 `grep -q`。** `grep -qE` 命中即早退 → 上游 `printf` 收 SIGPIPE → `set -o pipefail` 下整條 pipeline 回非零 → `if` 判成 false → **漏擋（fail-OPEN）**。要用 `grep -E "$RE" >/dev/null`（讀完全部輸入、不早退）。
2. **`git diff` 出錯要 fail-closed，不能 `|| true` 吞掉。** `added="$(git diff … || true)"` 會把 git 真出錯吞成空字串 → secret scan 跳過。要 `d="$(git diff …)" || fail`；「無變更」才是正常空輸出，「出錯」必須擋。
3. **路徑防線全程用解實體路徑（realpath），別一半用原始 `$OUT`。** symlink（如 iCloud「桌面與文件」）可繞過只比字串的檢查。往上找最近存在的祖先目錄 → `cd … && pwd -P` 打穿 symlink → 對原始值與 realpath 值**都**比雲端同步夾 denylist 和 git-repo 檢查。
4. **bash 3.2.57（macOS 內建）+ UTF-8 locale：中文/全形字緊貼 `$var` 會 crash。** bare `$OUT不外傳` 的 `$OUT不` 會把後續位元組吃進變數名 → `set -u` unbound → 腳本掛。**一律 `${var}`。** 收尾用 `grep -P '(?<!\{)\$\w+[\x80-\xff]'` 掃殘留。
5. **origin allowlist 要精確比對含 host，不能只比 owner/repo 子字串。** 否則 `evil.example.com/kkday-it/foo`、`github.com.attacker.net/…`、`…-evil` 後綴會過關。先剝尾端 `/` 與 `.git` 再對三種 remote 形式（https / git@ / ssh://）逐一 `case`。
6. **base branch 要試 `origin/main→origin/master→main→master` 才 fail。** 只試 main 的話，master 預設 repo 會 hard-fail 卡死自動流程（雖 fail-closed 安全，但要人工排解，破壞「一次到位」）。
7. **密碼只進 `chmod 600` 的 PGPASSFILE，不進 argv/env。** `umask 077` 子 shell 寫檔、`_esc` 跳脫 `:` 與 `\`、`unset PGPASSWORD`（優先序高於 PGPASSFILE）；**trap 裝在建檔前**（`EXIT` + `INT TERM HUP`），異常中斷立即刪 `.pgpass` 與所有 `.tmp`（半寫個資也清）。印產物清單前顯式再刪一次 `.pgpass`，讓 `ls` 不列出它。
8. **row counts 用單一交易 + 安全引用。** `BEGIN ISOLATION LEVEL REPEATABLE READ` + `format('SELECT %L, count(*) FROM %I.%I', …)` + `\gexec`（`\gexec` 前**不要**加 `;`）。`pg_dump` 產物用 `.tmp` → `mv` 原子覆蓋，失敗保留上一輪 good copy。

## 驗收這兩支腳本的方式（別只讀碼）

在**真實目標環境**跑：`/bin/bash` 3.2.57 + `LANG=zh_TW.UTF-8`（不是你開發機的 bash 5）。至少實測：
- `bash -n` 兩檔、無 CRLF、無 bash4+ 語法（`declare -A`/`mapfile`/`^^`/`,,`）。
- 造「大 diff + 早期命中」證 secret scan 讀滿全部才回、fail-closed；造「git diff 用 invalid rev」證出錯會擋。
- symlink 指進 `~/Documents` 證 realpath 打穿命中 denylist。
- 送 `TERM` 中斷證 `.pgpass`/`.tmp` 清乾淨。
- origin 餵偽造網域/個人 repo 證全擋。

## 多審者驗收的紀律（這是 11 輪的最大教訓）

跑「三個獨立審查者審到全 GO 才交付」時：
- **審查中絕不改檔。** 每次改都作廢所有先前審查；曾因時序讓三審看到不同版本、結論打架整輪作廢。收齊本輪三審發現 → 一次修完 → **凍結** → 才啟下一輪讓三審看同一版。
- **抓到一個 bug 先問「這是哪一類、還有哪裡同款」，做同類全掃**，別點狀修。fail-open 出現兩次卻分兩輪解，就是沒一次掃完 pipeline/指令出錯被吞的所有點。
- 三審每輪看同一凍結版、同時啟動，別讓時序製造版本差。
