# Conformance Gate Spec — Agent Tool-I/O 治理與 Onboarding 驗收

> 定位:本 spec **擴充**既有守門機制(`vibe-project-template/scripts/guard/validate_project.py`、`PROJECT.yaml`、workflow `manifest.yaml`、gitleaks),不取代。與 [vibe-cloud-ready-spec.md](vibe-cloud-ready-spec.md) 衝突時以 cloud-ready spec 為準;與 [project-template-v0.md](project-template-v0.md) §3 治理形狀對齊。
>
> 最高原則不變:**治理靠機器預設,不靠每位員工記得。** 本 spec 的每一條都必須落成 `guard` 可自動判定的檢查(error / warning),否則不列入 gate。

## 0. 為什麼需要這份 spec

現有 guard 是為「排程 script → audit log / status / notification」這個形狀設計的:PII masking 規約談的是「不要把裸 PII 寫進 audit/status/notification」(project-template-v0.md §3、§227-233)。

但 vibe coding 的實際形狀已經變成 **AI agent 呼叫工具**:agent 送「意圖」(工具名+參數)給模型,模型回傳被讀進 **model context**。這帶來一個現有 guard **完全沒涵蓋**的洩漏面:

> 凡是進入 model context 的資料(工具**輸入**參數 + 工具**輸出** `tool_result`)都會離開內網、送到 LLM 供應商(Anthropic 等)。

這條邊界跟「audit log 遮罩」是**兩件事**。一支排程 script 可以完全不碰 LLM;但一個 agent flow 的每次 tool call 都在跨這條線。本 spec 補上這一面,並把既有的寫入/憑證/所有權治理一併收斂成分級 onboarding gate。

## 1. 名詞

| 詞 | 意義 |
|---|---|
| **agent flow** | 由 AI agent(Claude Code/Desktop 等)透過工具呼叫驅動的 workflow。相對於純排程 script。 |
| **model context** | 送進 LLM 的內容:system prompt + 對話 + 工具輸入 + `tool_result`。**進了這裡 = 離境。** |
| **control plane / data plane** | control plane = 進 model context 的(意圖、ID、規則、筆數、欄位級 diff)。data plane = 完整資料(PII 本體),只在內網 server 記憶體 + 人工批准面板流動。 |
| **governed tool** | 由平台/`ctx.*` adapter 提供、有 schema 的工具。相對於通用 file/bash/任意 HTTP。 |
| **reference input** | 資料的參考(`file_id` / `handle` / `oid` / URL),而非資料本體。 |

## 2. Conformance 規則

每條規則格式:**規則 / 宣告於 / 自動檢查 / 嚴重度 / gate tier**。嚴重度 `error` = 紅燈擋 merge;`warning` = 提示不擋。gate tier = 從哪個 `risk_tier` 起強制為 error。

### A. 輸入閘門(agent 工具輸入)

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **A1** | 工具輸入**只收 reference,不收資料本體**。input schema 不得有承接整批資料的自由欄位(大 string / 任意長度 array)。這是把「模型手上流過的 PII 量」壓到最小的**主要**手段(見 A2 註)。 | `manifest.yaml` 的 `tools[].input_schema` | guard 掃 input schema:string 欄位若無 `maxLength`(或 > 512)且非白名單語意欄位 → 命中;**任何 array 欄位(不分 items 型別)無 `maxItems` → 命中**(防止用 `list[str]` 之類簡單陣列夾帶整批)。 | green: warning<br>yellow+: error | green(agent flow) |
| **A2** | **輸入端的 PII 走「遮罩」不走「阻擋」**:碰 PII 的工具,其輸入值進 audit log / status / notification 前一律 mask(沿用 §3);**不得**因輸入值命中 PII regex 就拒絕該次呼叫。 | `ctx.log` / `ctx` audit 層 | conformance test:對工具餵含 PII 的輸入,斷言 (a) 呼叫**正常執行**、(b) audit/status/notification 內該值已遮罩。 | yellow+: error | yellow |
| **A3** | **憑證形狀的輸入值一律 flag + mask(defense-in-depth,非 leak 防線)**:token / key / password / `vault://` 以外的 secret ref 出現在工具參數 = 設計錯誤(憑證應走 `vault://`),記 warning 並遮罩;不阻擋執行。 | `ctx` audit 層 + conformance test | 沿用 gitleaks 樣式庫掃參數值;命中 → warning + 遮罩入 log。 | warning | green |

> **為什麼輸入端不阻擋(A2/A3 的關鍵前提):** 工具輸入是 LLM **產生**的,送達工具前**早已在 model context 裡(已離境)**——在工具入口阻擋它不會挽回任何洩漏,只會癱瘓合法查詢(如以 email/手機當自然鍵查客人)。因此輸入端的洩漏控制手段是 **A1(從源頭減少模型碰到的 PII 量)+ 進 audit/log 前遮罩**,而非拒絕呼叫。真正的離境防線在輸出端(B)與資料流封鎖(C)。

### B. 輸出閘門(`tool_result` → model context)

> A1 只做了一半:就算輸入是 reference,輸出照樣可能把整批 PII 吐進 `tool_result`。B 是不可省的另一半。

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **B1** | `tool_result` **筆數 / 大小上限**(預設 ≤ 50 rows 或 ≤ 32 KB;可於 manifest 調高但需 reviewer 批註)。結構性逼工具走 handle / 摘要,而非回傳整批。 | `ctx.*` adapter 執行期(硬上限)+ `manifest.yaml` `tools[].output_limit` | (a) 執行期:`ctx` 回傳前量測,超過即截斷並回錯誤,強制開發者改設計。(b) CI:conformance test 斷言超限工具會失敗。 | 一律 error | green(agent flow) |
| **B2** | **no-PII-in-tool_result**:每個 governed tool 的輸出經共用 PII detector(見 §5),不得含裸 PII。**這是 PII 遮罩是否生效的唯一可靠驗證。** | conformance test harness(CI)+ **positive fixture**(見 B4) | **兩段斷言,順序不可顛倒**:(1) 先斷言工具回傳**非空、且含 `pii_fields` 宣告的欄位**(證明真的取到資料);(2) 再斷言輸出過 detector 無裸 PII。**只有 (1) 通過才算數**——否則工具回 404/空清單會讓 detector「因為沒東西可找而通過」,是假性綠燈。命中 → 紅燈。 | yellow+: error<br>green: warning | yellow(即 `touches.pii: true`) |
| **B3** | **宣告式 PII 欄位 + 預設遮罩**:碰 PII 的工具須宣告 `pii_fields`,framework 對 model 面自動 `redact()`,完整值只在人工批准面板顯示。 | `manifest.yaml` `tools[].pii_fields` | (a) **靜態(guard)只驗宣告**:`touches.pii: true` 時工具須宣告非空 `pii_fields`,缺 → 紅燈。(b) **遮罩是否真的生效,一律靠 B2 的兩段斷言驗證**(先取到含 PII 的真資料、再驗已遮罩)——**不做**「靜態偵測程式碼是否包了 `ctx.redact()`」(動態語言下 `safe = ctx.redact(x); return safe` 或包在 helper 都會誤判,不可靠)。 | yellow+: error | yellow |
| **B4** | **強制 positive fixture(讓 B2/B3 有東西可驗)**:碰 PII 的工具必須附一組**保證回傳非空、且含 `pii_fields` 資料**的測試 fixture(mock 或指向測試環境的穩定 `oid`/`id`)。 | `manifest.yaml` `tools[].test_fixture`(或 `tests/` 內對應檔) | 靜態 guard:`touches.pii: true` 的工具缺 `test_fixture` 宣告 → 紅燈(沿用既有「workflow 缺 tests/」的檢查風格)。執行期由 B2 的斷言 (1) 保證 fixture 真的產出資料,fixture 失效(回空)= 紅燈,不是靜默跳過。 | yellow+: error | yellow |

### C. 資料流封鎖(讓 PII 沒有旁門)

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **C1** | governed flow **不掛通用 file / bash / 任意 HTTP** 讀取工具。資料只能經 `ctx.*` adapter(server 端讀)。 | `manifest.yaml` `tools[]`(白名單) | guard:manifest 工具清單只准 `ctx.*` 家族與已註冊 governed tool;出現通用讀檔/exec/raw fetch → 命中。 | yellow+: error | yellow |
| **C2** | 資料讀寫**只走 `ctx.*`**,禁原生 DB client / 直連 SDK。 | 既有 `check_forbidden_deps` + runtime | **靜態層只靠 `check_forbidden_deps`(依賴清單比對,語言無關,`.ts` 專案同樣涵蓋)偵測原生 driver / 直連 SDK。** **不新增** `open(` 之類的字串內容掃描——現行 `anti_patterns` 是 `.py`-only 的小寫子字串比對,加 `open(` 會誤傷 `subprocess.Popen(`/`urlopen(`/`file.isopen()` 且完全漏掉 `.ts`,不可靠。「禁止繞過 `ctx` 直接開檔/連線」由 M3 runtime 沙盒約束(見 D1 同款 least-privilege 思路),不靠脆弱靜態掃描。 | 沿用既有(yellow+: error) | 現狀 + 依賴擴充 |
| **C3** | **出網 allowlist(deny-by-default)**:runtime 只能連 `touches.external_sites` 宣告過的 host。 | `PROJECT.yaml` `touches.external_sites` | (a) 平台 runtime:egress 依宣告 allowlist,未宣告 host 一律拒。(b) guard:靜態掃出現的外部 host 未在宣告清單 → warning(靜態偵測不完備,以 runtime 為準)。 | runtime: 一律 error<br>guard: warning | 現狀強化 |

### D. 寫入護欄

> 對映 be2-mcp 已 live 驗證的 change-set 機制。碰生產寫入的 flow 適用。

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **D1** | 寫入生產系統**一律 draft-only + 人工批准**;agent 結構上拿不到批准憑證。 | `manifest.yaml` `tools[].effect: write` + `approval: required` + **runtime 最小權限** | **靜態 guard 是必要但不充分**:任何 `effect: write` 工具須宣告 `approval: required` 且指向平台批准通道(非工具自帶),缺 → 紅燈。**但光靠宣告可被繞過**——cloud-ready spec 給 app runtime CRUD DB 權限,開發者只要**不宣告** `effect: write` 就能經 `ctx.db` 直接 `UPDATE`/`DELETE`,guard 抓不到。**load-bearing 的控制是 runtime 最小權限(M3)**:agent 執行情境的 DB 連線限 read-only role / draft schema,生產寫入只能由**已批准的 executor** 用另一組較高權限憑證執行。未宣告的直接寫入因此在**權限層**被擋,而非只靠宣告誠實。 | 一律 error(靜態)+ runtime enforce | 任何 write flow |
| **D2** | 寫入 flow **必須宣告冪等鍵**(dedup key),重跑/備援不雙寫。 | `manifest.yaml` `tools[].idempotency_key` | guard:`effect: write` 缺 `idempotency_key` → 紅燈。(呼應富邦「出團日\|團號」實例。) | 一律 error | 任何 write flow |
| **D3** | **爆炸半徑上限**:單次寫入筆數上限,超過需額外批准。 | `manifest.yaml` `tools[].max_write_batch` | guard:`effect: write` 缺 `max_write_batch` → warning;runtime 超限需二次批准。 | guard: warning<br>runtime: error | yellow+ |

### E. 不孤兒 + 可觀測(解「壞了沒人修」)

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **E1** | **owner + escalation 必填**。既有 `owner`(人)之外,red / 有 external_sites 的 flow 須有 `escalation`(壞掉時 call 誰)。 | `PROJECT.yaml` `owner` + 新增 `escalation` | validate_project.py:`risk_tier: red` 或 `external_sites` 非空時 `escalation` 必填。 | red / external: error | red / external RPA |
| **E2** | **external / RPA flow 必須有 healthcheck + 破壞告警**。vendor UI/契約一斷,由 healthcheck 早期發現並告警給 escalation。 | `PROJECT.yaml`(單檔內可驗) | validate_project.py:`touches.external_sites` 非空時,`schedules` 必須含至少一個 `healthcheck*` task **且** `alert` 目標必填(見下)。**只在 `PROJECT.yaml` 單檔內檢查,不做跨檔關聯**——`schedules` 是專案級 map、workflow `manifest` 的 alert route 是 workflow 級,兩者無 schema 連結,script 無法可靠對應。故 alert 目標統一提升為 `PROJECT.yaml` 頂層欄位(可复用 E1 的 `escalation`),讓「有 healthcheck + 有告警對象」成為單檔可判定的條件。 | external: error | external RPA |
| **E3** | **run ledger**:每次執行記 `run_id / actor / 處理數 / 失敗數 / 結果`;PII 一律 mask(沿用 §3 masking)。 | 平台 runtime 標準輸出 | 平台側標準化(非 per-repo guard);manifest 宣告 flow 即自動繼承。 | — | 全部 |

## 3. Onboarding Gate(接上既有 `risk_tier`)

分級疊加。上一級的全部要求下一級照收。

### 🟢 Green — 低爆炸半徑
現狀(PROJECT.yaml + secret scan + cloud-ready guard)**若該專案含 agent flow,再加**:
- A1 輸入 reference-only(green: warning)、A3 憑證形狀參數(warning)
- **B1 輸出上限(error)**、B2 no-PII-in-tool_result(green: warning)

### 🟡 Yellow — 碰 PII / 寫入 / 排程(`touches.pii: true` 自動落此級)
綠區全部,且 A1 升為 **error**;再加:
- **A2 輸入遮罩(error)、B2 no-PII-in-tool_result(error)、B3 宣告 pii_fields(error)**
- **C1 工具白名單、C3 egress allowlist**
- 若含寫入:**D1 draft-only+批准、D2 冪等鍵(error)**、D3 半徑上限
- **E1 escalation**(若有 external)

### 🔴 Red — 高風險寫入 / 外部 RPA / 大量 PII
黃區全部 + :
- **E1 escalation(必填)、E2 healthcheck+告警(external 必填)、E3 run ledger**
- **external RPA:vendor ToS / 破驗證碼 風險評估記錄**(`PROJECT.yaml` `vendor_tos_reviewed: <date/ref>`,缺 → 紅燈)
- 額外人工審查(平台流程,非 guard)

## 4. 誠實邊界:框架強制 vs 政策

- **框架強制(本 spec 全部)**:A–E 皆落成 guard error/warning 或 runtime 硬限 + conformance test。這是 framework 的價值——規則變成綠燈才能過。
- **框架強制不了**:員工把 PII **貼進 Claude 對話**(不經任何 governed flow)。此通道 guard 看不到,只能靠 (a) 企業帳號條款(no-training / retention / ZDR)、(b) 使用政策、(c) 提供一條好到不必貼的 governed 路。**不得用工程手段假裝能封死此通道。** 本 spec 只負責 governed flow 這條。

## 5. 實作落點與分期

對映既有檔案,逐條標落點:

**M1(擴充 guard,純靜態,無 runtime 依賴)**
- `validate_project.py`:新增 A1(input schema lint:string maxLength / array maxItems)、B3 靜態層(`pii: true` 時 `pii_fields` 必填)、B4(`pii: true` 的工具缺 `test_fixture` → 紅燈)、C1(工具白名單)、D1/D2/D3(write flow manifest 檢查)、E1(escalation 必填條件)、E2(`external_sites` 非空時 `schedules` 含 `healthcheck*` + `alert` 必填,**單檔內判定**)、Red 的 `vendor_tos_reviewed`。
- `PROJECT.yaml` schema:新增 `escalation`、`alert`(E2 告警對象,可複用 escalation)、`vendor_tos_reviewed`(選填,red 必填)。
- `manifest.yaml` schema:新增 `tools[].{input_schema, output_limit, pii_fields, test_fixture, effect, approval, idempotency_key, max_write_batch}`。
- `check_forbidden_deps` 擴充 native DB driver 樣式(語言無關,涵蓋 `.ts`),吸收原 C2 的意圖(不做內容字串掃描)。
- 更新 `vibe-project-template/CLAUDE.md`:把 A–E 寫成 AI coding 規則(讓 agent 產出即合規)。

**M2(conformance test harness)** — PII 遮罩「是否真的生效」的唯一可靠驗證層
- 新增 `scripts/guard/conformance/`:對每個 governed tool 跑 fixture,執行 A2(輸入含 PII 時呼叫仍成功、且 audit/log 已遮罩)、A3(憑證形狀參數被遮罩)、B1(輸出上限)、**B4→B2→B3 的順序斷言:先用 positive fixture 確認回傳非空且含 `pii_fields`(fixture 失效=紅燈,非跳過),再驗無裸 PII、再驗 model 面已遮罩**。CI 綠燈才算過。
- PII/secret detector:抽成共用模組,A2/A3/B2/B3 與 gitleaks 樣式庫共用。

**M3(runtime,依賴平台)** — 光靠宣告會被繞過的那些,由權限/沙盒層兜底
- `ctx.*` adapter 落:B1 輸出硬限、C2/C1「非 `ctx` 不能碰資料/外界」的沙盒約束、C3 egress allowlist、D3 runtime 半徑、E3 run ledger、A2/A3 進 log 前遮罩。
- **D1 最小權限(load-bearing)**:agent 執行情境的 DB 連線限 read-only role / draft schema;生產寫入僅由已批准 executor 以另一組憑證執行。未宣告的直接寫入在權限層被擋。
- 對映 [docs/roadmap.md](docs/roadmap.md) 的平台化項目。

**驗收標準**:一個新 agent flow 專案,不看文件、只跑 `guard` + conformance harness,就能被正確判定 green/yellow/red 並擋下所有可**靜態/測試判定**的 A–E 違規(A1/B1/B2/B3/B4/C1/D1-宣告/D2/E1/E2);而「宣告可繞過」的部分(D1 未宣告直寫、C2 繞 `ctx`、C3 未宣告 host)由 M3 runtime 權限/沙盒兜底。開發者要通過只能把設計改對,不能繞過。這就是「治理靠機器預設」的落地。

<!-- agy-peer-reviewed: 2026-08-22T16:15:31Z rounds=3 verdict=approved -->
