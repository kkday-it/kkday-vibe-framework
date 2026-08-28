# Conformance Gate Spec — Agent Tool-I/O 治理與 Onboarding 驗收

> 定位:本 spec **擴充**既有守門機制(`vibe-project-template/scripts/guard/validate_project.py`、`PROJECT.yaml`、workflow `manifest.yaml`、gitleaks),不取代。與 [vibe-cloud-ready-spec.md](vibe-cloud-ready-spec.md) 衝突時以 cloud-ready spec 為準;與 [project-template-v0.md](project-template-v0.md)「風險分級與 guard」節治理形狀對齊。
>
> 最高原則不變:**治理靠機器預設,不靠每位員工記得。** 本 spec 的每一條都必須落成 `guard` 可自動判定的檢查(error / warning),否則不列入 gate。
>
> **讀者:vibe-coding 使用者的 AI coding agent。** 本文的規則會被鏡射進 `vibe-project-template/CLAUDE.md` 當 AI 開發規約,讓 agent 產出的 flow **一次就合規**。因此每條規則都寫成「宣告在哪個真實欄位 + guard 怎麼判」,agent 照抄即可,不需要理解背後動機。

## 0. 為什麼需要這份 spec

現有 guard 是為「排程 script → audit log / status / notification」這個形狀設計的:PII masking 規約談的是「不要把裸 PII 寫進 audit/status/notification」(見 project-template-v0.md 的「憑證與 PII 規約」「audit log masking」節)。**注意:該規約把 masking 寫成原則,但目前 `platform_sdk` 的 `LogManager` 並未實作任何遮罩、也沒有 `ctx.redact()`——見本文 §5,本 spec 依賴的遮罩能力是待建的淨新增,不是既有擴充。**

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

> **manifest 對映(重要):本 framework 的可呼叫單位是 workflow,不是 tool。** 一個 `workflows/<name>/manifest.yaml` = 一個 agent 可呼叫的 flow;現行 schema 為 `version` + `workflow:{id,name,description,risk_tier}` + `permissions:{credentials[], network.allow_hosts[], needs_browser}`,並可有 workflow 級的 `inputs:` / `outputs:` map(⚠️ `example/legacy_not_compliant/` 已被 `.gitignore` 排除、未 commit 進 repo,是作者本機的過渡期私有素材,不是可 clone 取得的參考——**新 clone 這個 repo 的人看不到它**,實作時不能假設它存在;compliant 的 `workflows/hello_world/manifest.yaml` 目前只有 `workflow:` + `permissions:`,未含 inputs/outputs,是唯一 tracked 的範本)。**本 spec 不新增 `tools[]` 陣列**;下列所有新欄位都掛在既有區塊上:`inputs.<field>.*`(A 輸入)、`workflow.*`(B/D 的 flow 級屬性)、`outputs.<field>.pii`(B3)、`permissions.network.allow_hosts`(C3,既有欄位)。「per-tool」在此框架即「per-workflow」。

### A. 輸入閘門(agent 工具輸入)

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **A1** | 工具輸入**只收 reference,不收資料本體**。input schema 不得有承接整批資料的自由欄位(大 string / 任意長度 array / 無邊界 object)。這是把「模型手上流過的 PII 量」壓到最小的**主要**手段(見 A2 註)。 | `manifest` 的 workflow 級 `inputs.<field>` | guard 掃 `inputs` 各欄位:`type: string` 欄位若無 `maxLength`(或 > 512)且非白名單語意欄位 → 命中;`type: array` 欄位(不分 items 型別)無 `maxItems` → 命中(防止用 `list[str]` 之類簡單陣列夾帶整批);**`type: object` 欄位若無 `maxProperties` 且無 `additionalProperties: false` → 命中**(否則 agent 能塞任意深度/大小的自由 JSON payload,完全繞過 reference-only 的意圖,string/array 的邊界防線白做)。 | green: warning<br>yellow+: error | green(agent flow) |
| **A2** | **輸入端的 PII 走「遮罩」不走「阻擋」**:碰 PII 的工具,其輸入值進 audit log / status / notification 前一律 mask(沿用 §3);**不得**因輸入值命中 PII regex 就拒絕該次呼叫。 | `ctx.log` / `ctx` audit 層 | conformance test:對工具餵含 PII 的輸入,斷言 (a) 呼叫**正常執行**、(b) audit/status/notification 內該值已遮罩。 | yellow+: error | yellow |
| **A3** | **憑證形狀的輸入值一律 flag + mask(defense-in-depth,非 leak 防線)**:token / key / password / `vault://` 以外的 secret ref 出現在工具參數 = 設計錯誤(憑證應走 `vault://`),記 warning 並遮罩;不阻擋執行。 | `ctx` audit 層 + conformance test | 沿用 gitleaks 樣式庫掃參數值;命中 → warning + 遮罩入 log。 | warning | green |

> **為什麼輸入端不阻擋(A2/A3 的關鍵前提):** 工具輸入是 LLM **產生**的,送達工具前**早已在 model context 裡(已離境)**——在工具入口阻擋它不會挽回任何洩漏,只會癱瘓合法查詢(如以 email/手機當自然鍵查客人)。因此輸入端的洩漏控制手段是 **A1(從源頭減少模型碰到的 PII 量)+ 進 audit/log 前遮罩**,而非拒絕呼叫。真正的離境防線在輸出端(B)與資料流封鎖(C)。

### B. 輸出閘門(`tool_result` → model context)

> A1 只做了一半:就算輸入是 reference,輸出照樣可能把整批 PII 吐進 `tool_result`。B 是不可省的另一半。

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **B1** | `tool_result` **筆數 / 大小上限**(預設 ≤ 50 rows 或 ≤ 32 KB;可於 manifest 調高但需 reviewer 批註)。結構性逼工具走 handle / 摘要,而非回傳整批。**上限卡在「flow 回傳給 model context 的最終值」,不是 `ctx.db`/`ctx.sheet` 這些資料抓取 adapter 本身**——workflow 內部要在記憶體裡拿 500 筆做彙總、篩選、算統計完全合法(data plane,見 §1),只有最後回給 agent 的 `tool_result` 要卡量;若卡在 `ctx.*` 抓取層,workflow 連正常的內部彙總都做不到。 | flow 執行框架的**回傳邊界**(即 `flow()` 函式的 return 值,進 model context 前的最後一關)+ `manifest` `workflow.output_limit` | (a) 執行期:框架在 `flow()` 回傳之後、组成 `tool_result` 之前量測,超過即截斷並回錯誤,強制開發者改設計(**不在** `ctx.db.query()`/`ctx.sheet.get()` 等中間呼叫點卡)。(b) CI:conformance test 斷言超限 flow 會失敗。 | 一律 error | green(agent flow) |
| **B2** | **no-PII-in-tool_result**:每個 governed tool 的輸出經共用 PII detector(見 §5),不得含裸 PII。**這是 PII 遮罩是否生效的唯一可靠驗證。** | conformance test harness(CI)+ **positive fixture**(見 B4,僅 PII-touching workflow 適用) | **依 B3/B4 是否適用該 workflow 分兩支,不是所有 workflow 都跑同一套**:① **workflow 標了 `outputs.*.pii: true`(B3/B4 適用)**——兩段斷言,順序不可顛倒:(1) 先斷言工具回傳**非空、且含 `pii_fields` 宣告的欄位**(證明真的取到資料);(2) 再斷言輸出過 detector 無裸 PII。**只有 (1) 通過才算數**——否則工具回 404/空清單會讓 detector「因為沒東西可找而通過」,是假性綠燈。命中 → 紅燈。② **workflow 沒標 `outputs.*.pii: true`(未宣告碰 PII,無 `pii_fields`/`test_fixture` 可用)**——不跑 (1) 的非空斷言(該工具本來就不承諾回傳 PII 資料),直接拿它既有的一般測試輸出過 detector,命中裸 PII → 視為**未宣告卻意外洩漏**,一樣紅燈/warning(依 gate);沒命中則過,不因為沒有 `pii_fields` 就被 (1) 卡死產生假性紅燈。 | ①②皆:yellow+: error<br>green: warning | yellow(即 `touches.pii: true`) |
| **B3** | **宣告式 PII 欄位 + 預設遮罩**:碰 PII 的工具須宣告 `pii_fields`,framework 對 model 面自動 `redact()`,完整值只在人工批准面板顯示。**觸發層級是 workflow,不是專案**——`touches.pii: true` 只代表「這個專案裡有工作流碰 PII」,不代表專案裡每一個 workflow 都碰 PII;硬性要求所有 flow 都宣告 `pii_fields` 會逼不碰 PII 的 flow(如純打公開資料的查詢)也要生一組假 `pii_fields`,規則本身變成噪音。 | `manifest` `workflow.pii_fields`(或標 `outputs.<field>.pii: true`) | (a) **靜態(guard)分兩層**:① **per-workflow 觸發**——任一 workflow 的 manifest 若標了 `outputs.<field>.pii: true`(或宣告非空 `workflow.pii_fields`),該 workflow 必須有非空 `pii_fields`,缺 → 紅燈;沒標 `outputs.*.pii` 的 workflow 不受此規則約束。② **專案級一致性檢查**——`touches.pii: true` 的專案裡,若掃過所有 workflow 都沒有任何一個標 `outputs.*.pii: true`,→ warning(旗標形同虛設,提示 team 要嘛補標、要嘛拿掉 `touches.pii`)。(b) **遮罩是否真的生效,一律靠 B2 的兩段斷言驗證**(先取到含 PII 的真資料、再驗已遮罩)——**不做**「靜態偵測程式碼是否包了 `ctx.redact()`」(動態語言下 `safe = ctx.redact(x); return safe` 或包在 helper 都會誤判,不可靠)。 | ①per-workflow: yellow+ error<br>②專案級: warning | yellow |
| **B4** | **強制 positive fixture(讓 B2/B3 有東西可驗)**:碰 PII 的工具必須附一組**保證回傳非空、且含 `pii_fields` 資料**的測試 fixture(mock 或指向測試環境的穩定 `oid`/`id`)。**同 B3,觸發層級是 workflow**:只有標了 `outputs.*.pii: true` 的 workflow 才需要。 | `manifest` `workflow.test_fixture`(或 `workflows/<name>/tests/` 內對應檔) | 靜態 guard:workflow 標了 `outputs.*.pii: true` 卻缺 `test_fixture` 宣告 → 紅燈(沿用既有「workflow 缺 tests/」的檢查風格)。執行期由 B2 的斷言 (1) 保證 fixture 真的產出資料,fixture 失效(回空)= 紅燈,不是靜默跳過。 | yellow+: error | yellow |

### C. 資料流封鎖(讓 PII 沒有旁門)

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **C1** | flow **只能經 `ctx.*` adapter 碰資料/外界**,不得用通用 file / bash / 任意 raw HTTP。**例外(sanctioned):`ctx.browser.new_page()`(受管 Playwright)是外部 RPA 的合法路徑**,由 `manifest permissions.needs_browser: true` 宣告後開放——它本身就是 `ctx` 家族,不算違規。 | `manifest permissions.{needs_browser, network.allow_hosts}` + 依賴檢查 | guard:出現 `requests`/`httpx`/原生 socket/直連 SDK 等繞過 `ctx` 的依賴 → 命中(沿用 `check_forbidden_deps`);`ctx.browser.new_page()` 因 `needs_browser` 宣告而豁免。「禁直接開檔/連線」的完整強制在 M3 runtime 沙盒。 | yellow+: error | yellow |
| **C2** | 資料讀寫**只走 `ctx.*`**,禁原生 DB client / 直連 SDK。 | 既有 `check_forbidden_deps` + runtime | **靜態層只靠 `check_forbidden_deps`(依賴清單比對,語言無關,`.ts` 專案同樣涵蓋)偵測原生 driver / 直連 SDK。** **不新增** `open(` 之類的字串內容掃描——現行 `anti_patterns` 是 `.py`-only 的小寫子字串比對,加 `open(` 會誤傷 `subprocess.Popen(`/`urlopen(`/`file.isopen()` 且完全漏掉 `.ts`,不可靠。「禁止繞過 `ctx` 直接開檔/連線」由 M3 runtime 沙盒約束(見 D1 同款 least-privilege 思路),不靠脆弱靜態掃描。 | 沿用既有(yellow+: error) | 現狀 + 依賴擴充 |
| **C3** | **出網 allowlist(deny-by-default)**:runtime 只能連 flow 宣告過的 host。 | **`manifest permissions.network.allow_hosts`**(既有欄位,見 hello_world 範本)——這是**執行點**;`PROJECT.yaml touches.external_sites` 只是專案級清單盤點,兩者須一致但 allowlist 以 manifest 為準。 | (a) 平台 runtime:egress 依 `allow_hosts` 過濾,未宣告 host 一律拒。(b) guard:`touches.external_sites` 與各 workflow `allow_hosts` 不一致 → warning(靜態偵測不完備,以 runtime 為準)。 | runtime: 一律 error<br>guard: warning | 現狀強化 |
| **C4** | **檔案存取邊界**(對映 project-template-v0.md §8「拿錯檔案三重防呆」):跨專案越權、同名檔模糊搜尋、來源資料未驗 schema 就使用。**這條不是 per-workflow 規則,是 adapter 契約本身的設計約束**——收斂進單一 `ctx.sheet`/`ctx.storage` adapter 實作,而非要求逐個 workflow 自律。 | `ctx.sheet`/`ctx.storage` adapter 原始碼(單一位置,不隨 workflow 數量增加) | ⚠️ **分三層誠實標註,不比照其他規則假裝全覆蓋**:(a) **跨專案越權**——**`PROJECT.yaml` 需新增 `touches.google_scope`(folder/sheet ID 陣列,見 project-template-v0.md §4 schema 更新)**。⚠️ **不是靜態白名單比對**:adapter 介面仍要接受任意 `file_id`(否則資料夾內動態新增的檔案讀不到,如「處理這個資料夾裡今天的報表」這種常見用法),但**執行期**要向 Google API 查該 `file_id` 的 parent chain,確認它是 `google_scope` 內某個 folder/sheet 的**子孫**(不是「id 本身完全等於清單裡的值」這種淺層比對),不在範圍內拋 `PermissionError`。⚠️ **禁止每次存取都重新遞迴查 parent chain**:對大量檔案(如批次處理一個資料夾)逐檔案打 `files.get` 往上爬會立刻撞 Google Drive API rate limit,把安全層做成效能瓶頸。**adapter 必須快取 containment 判定結果**(如 `file_id`→`bool` 的 LRU/TTL cache,同一 run 內同一 folder 判過的子孫不重查),或優先走 folder-listing 層級一次性解析(`files.list(parent=folder_id)` 取得該 folder 底下全部子項,一次查、多次用),而非對每個檔案各自遞迴。M2 對 adapter 本身跑單元測試:① 清單內 ID 本身可存取;② 清單內某 folder 底下的子檔案可存取(驗證遞迴 containment,不是只驗表層);③ 清單外的 ID(含清單外 folder 底下的子檔案)一律 `PermissionError`;④ 批次存取同一 folder 下多個檔案時,API 呼叫次數不隨檔案數線性增長(驗證快取生效);(b) **模糊搜尋**——adapter 介面設計上只提供 `get(file_id)` / `get(path)`,不提供 `search(name_contains=...)` 這類方法,從介面上排除違規可能,M2 對 adapter 原始碼跑一次靜態檢查(不是逐 workflow 掃,adapter 只有一份);(c) **來源資料未驗 schema**——**目前無可靠自動判定手段**(同 C2 的理由:對 workflow 內容做「有沒有驗證」的字串/AST 掃描不可靠,誤判率高),留在 CLAUDE.md 當 AI coding 規範與 code review checklist 項目,**不宣稱有 guard/conformance test 覆蓋**。 | (a)(b): M2 error(adapter 層一次性測試)<br>(c): 無(code review only,誠實標示) | yellow+(碰外部檔案的 flow) |

### D. 寫入護欄

> 對映 be2-mcp 已 live 驗證的 change-set 機制。碰生產寫入的 flow 適用。

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **D1** | 寫入生產系統**一律 draft-only + 人工批准**;agent 結構上拿不到批准憑證。 | `manifest workflow.effect: write` + `workflow.approval: required` + **runtime 最小權限** | **靜態 guard 是必要但不充分**:任何 `effect: write` flow 須宣告 `approval: required` 且指向平台批准通道(非 flow 自帶),缺 → 紅燈。**但光靠宣告可被繞過**——cloud-ready spec 給 app runtime CRUD DB 權限,開發者只要**不宣告** `effect: write` 就能經 `ctx.db` 直接 `UPDATE`/`DELETE`,guard 抓不到。**load-bearing 的控制是 runtime 最小權限(M3)**:agent 執行情境的 DB 連線限 read-only role / draft schema,生產寫入只能由**已批准的 executor** 用另一組較高權限憑證執行。未宣告的直接寫入因此在**權限層**被擋,而非只靠宣告誠實。⚠️ 前提:`ctx.db` 目前是 `_NotYet` 佔位(見 `context.py`),此控制需先把 db adapter 連上並支援 role 分離,屬 M3。 | 一律 error(靜態)+ runtime enforce | 任何 write flow |
| **D2** | 寫入 flow **必須宣告冪等鍵**(dedup key),重跑/備援不雙寫。 | `manifest workflow.idempotency_key` | guard:`effect: write` 缺 `idempotency_key` → 紅燈。(呼應富邦「出團日\|團號」實例。) | 一律 error | 任何 write flow |
| **D3** | **爆炸半徑上限**:單次寫入筆數上限,超過需額外批准。 | `manifest workflow.max_write_batch` | guard:`effect: write` 缺 `max_write_batch` → warning;runtime 超限需二次批准。 | guard: warning<br>runtime: error | yellow+ |

### E. 不孤兒 + 可觀測(解「壞了沒人修」)

| # | 規則 | 宣告於 | 自動檢查 | 嚴重度 | gate |
|---|---|---|---|---|---|
| **E1** | **owner + escalation 必填**。既有 `owner`(人)之外,red / 有 external_sites 的 flow 須有 `escalation`(壞掉時 call 誰)。 | `PROJECT.yaml` `owner` + 新增 `escalation` | validate_project.py:`risk_tier: red` 或 `external_sites` 非空時 `escalation` 必填。 | red / external: error | red / external RPA |
| **E2** | **external / RPA flow 必須有 healthcheck + 破壞告警**。vendor UI/契約一斷,由 healthcheck 早期發現並告警給 escalation。 | `PROJECT.yaml`(單檔內可驗) | validate_project.py:`touches.external_sites` 非空時,`schedules` 必須含至少一個 `healthcheck*` task。**告警對象不新增欄位,直接複用 E1 的 `escalation`**——E2 的觸發條件(`external_sites` 非空)是 E1 觸發條件的嚴格子集,任何觸發 E2 的 flow,`escalation` 早被 E1 強制非空,另立 `alert` 欄位對 guard 判斷不增加任何資訊,只會讓 agent 多一個「這裡填 alert 還是 escalation」的無謂判斷。**只在 `PROJECT.yaml` 單檔內檢查,不做跨檔關聯**——`schedules` 是專案級 map,「有 healthcheck + escalation 非空(已由 E1 保證)」是單檔可判定的條件。 | external: error | external RPA |
| **E3** | **run ledger**:每次執行記 `run_id / actor / 處理數 / 失敗數 / 結果`;PII 一律 mask(沿用 §3 masking)。 | 平台 runtime 標準輸出 | ⚠️ **誠實揭露(比照 D1 的坦誠處理,不像其他規則靜默豁免)**:平台側標準化,非 per-repo guard,**目前也沒有 conformance test 斷言「ledger 真的被寫入且欄位完整」**——manifest 宣告 flow 即自動繼承只是設計意圖,不是已驗證的保證。M2 應補一條 conformance test:對任一 flow 執行後,斷言平台輸出裡存在一筆含 `run_id/actor/處理數/失敗數/結果` 的紀錄(對映 `docs/roadmap.md` R9);在該測試補上前,ledger 若漏欄位或没寫入,不會有任何紅燈。 | 目前:—(待 M2 補測試後升 error) | 全部 |

## 3. Onboarding Gate(接上既有 `risk_tier`)

分級疊加。上一級的全部要求下一級照收。

### 🟢 Green — 低爆炸半徑
現狀(PROJECT.yaml + secret scan + cloud-ready guard)**若該專案含 agent flow,再加**:
- A1 輸入 reference-only(green: warning)、A3 憑證形狀參數(warning)
- **B1 輸出上限(error)**、B2 no-PII-in-tool_result(green: warning)

### 🟡 Yellow — 碰 PII / 寫入 / 排程(`touches.pii: true` 自動落此級)
綠區全部,且 A1 升為 **error**;再加:
- **A2 輸入遮罩(error)、B2 no-PII-in-tool_result(error)、B3 宣告 pii_fields(error)**
- **C1 工具白名單、C3 egress allowlist、C4 檔案存取邊界**(碰外部檔案的 flow)
- 若含寫入:**D1 draft-only+批准、D2 冪等鍵(error)**、D3 半徑上限
- **E1 escalation**(若有 external)

### 🔴 Red — 高風險寫入 / 外部 RPA / 大量 PII
黃區全部 + :
- **E1 escalation(必填)、E2 healthcheck(external 必填,告警對象直接吃 E1 的 escalation)、E3 run ledger**
- **external RPA:vendor ToS / 破驗證碼 風險評估記錄**(`PROJECT.yaml` `vendor_tos_reviewed: <date/ref>`,缺 → 紅燈)
- 額外人工審查(平台流程,非 guard)

## 4. 誠實邊界:框架強制 vs 政策

- **框架強制(本 spec 全部)**:A–E 皆落成 guard error/warning 或 runtime 硬限 + conformance test。這是 framework 的價值——規則變成綠燈才能過。
- **框架強制不了**:員工把 PII **貼進 Claude 對話**(不經任何 governed flow)。此通道 guard 看不到,只能靠 (a) 企業帳號條款(no-training / retention / ZDR)、(b) 使用政策、(c) 提供一條好到不必貼的 governed 路。**不得用工程手段假裝能封死此通道。** 本 spec 只負責 governed flow 這條。

## 5. 實作落點與分期

對映既有檔案,逐條標落點:

**M1(擴充 guard,純靜態,無 runtime 依賴)**
- `validate_project.py`:新增 A1(input schema lint:string maxLength / array maxItems / **object maxProperties 或 additionalProperties: false**)、B3 靜態層(**workflow 自己標 `outputs.*.pii: true` 時 `pii_fields` 必填**;另外 `touches.pii: true` 的專案若掃不到任何一個這樣的 workflow → warning)、B4(標了 `outputs.*.pii: true` 的 workflow 缺 `test_fixture` → 紅燈)、C1(工具白名單)、C4(a)(b)(adapter 契約單元測試,見下)、D1/D2/D3(write flow manifest 檢查)、E1(escalation 必填條件)、E2(`external_sites` 非空時 `schedules` 含 `healthcheck*` task,**單檔內判定**,告警對象複用 E1 的 escalation 不新增欄位)、Red 的 `vendor_tos_reviewed`。
- `PROJECT.yaml` schema:新增 `escalation`、`vendor_tos_reviewed`(選填,red 必填)、**`touches.google_scope`(folder/sheet ID 陣列,C4(a) 用,碰 Google Sheet/Drive 的專案才填)**。**不新增 `alert` 欄位**(E2 直接吃 `escalation`)。
- `manifest.yaml` schema(**掛在既有 `workflow:` / `inputs:` 區塊,不新增 `tools[]`**):`inputs.<field>.{maxLength,maxItems}`(A1)、`workflow.{output_limit, pii_fields, test_fixture, effect, approval, idempotency_key, max_write_batch}`(B/D);`outputs.<field>.pii` 選用(B3)。egress 沿用既有 `permissions.network.allow_hosts`(C3),不新增欄位。
- `check_forbidden_deps` 擴充 native DB driver / raw HTTP client 樣式(語言無關,涵蓋 `.ts`),吸收原 C2/C1 的意圖(不做內容字串掃描);`ctx.browser.new_page()` 因 `needs_browser` 宣告豁免。
- 更新 `vibe-project-template/CLAUDE.md`:把 A–E 寫成 AI coding 規則(讓 agent 產出即合規)。

**M2(conformance test harness + 遮罩能力)** — PII 遮罩「是否真的生效」的唯一可靠驗證層
- **先建淨新增能力**:`ctx.redact(value, fields)` 與 `LogManager` 的自動遮罩(目前 `context.py` 的 `LogManager._emit` 逐字寫、零遮罩)——A2/B3/E3 全靠它,現在**不存在**,必須先實作。
- ⚠️ **`NotificationManager`(`ctx.notify`)是遮罩死角,Python/TS 兩邊都要接上**:A2 規則明文「進 audit log / status / notification 前一律 mask」涵蓋三個面,但 `NotificationManager.__call__`(`platform_sdk/py`)把呼叫端組好的 `message` 字串直送 Slack webhook(`requests.post`),`Notify.slack()`(`platform_sdk/ts`)同樣把 `msg` 直接 `fetch` 給 webhook——兩邊都完全不經任何遮罩管線,不是靠「先建 `LogManager` 自動遮罩」就能連帶涵蓋的獨立路徑。`ctx.notify()` 送出前(py/ts 都要)也要跑 `ctx.redact()`,否則 A2/E1 escalation 通知本身就是一個現成的裸 PII 外洩口。C1/C2 聲稱「語言無關,`.ts` 專案同樣涵蓋」只適用於依賴清單掃描,遮罩這一項若只修 Python 就不算涵蓋。
- ⚠️ **`render_status.py` 目前讀不到任何東西,不能宣稱「自動安全」**:`LogManager._emit` 依 cloud-ready spec §2.9 只印 stdout(`self.path` 只是保留欄位,`LogManager` 本身不寫檔),`render_status.py` 要讀的 `runs/<run_id>.jsonl` 現在沒有任何程式碼會產生——狀態頁不是「已經安全」,是「目前讀空氣」,屬 legacy(pre-cloud-ready)元件與現行 stdout-only log 路徑脫節,對映 `docs/roadmap.md` R5「status renderer 強制檢查」待補項。M2 的遮罩範圍**只保證 stdout 這條活路徑**(`_emit` 印出前 mask);`render_status.py` 要嘛跟著改成讀平台側 audit log store(K8s log collector 之後的儲存層),要嘛在 roadmap 標記為停用,兩者都不是「什麼都不用做,自動安全」。
- 新增 `scripts/guard/conformance/`:對每個 governed flow 跑 fixture,執行 A2(輸入含 PII 時呼叫仍成功、且 audit/log **與 notify 訊息**已遮罩)、A3(憑證形狀參數被遮罩)、B1(輸出上限)。**B2 依 workflow 是否標 `outputs.*.pii: true` 分兩支**(§2 B2 已更新,harness 實作須同步跟這支邏輯,不能全部 workflow 套同一套):① 標了 `outputs.*.pii: true` 的 flow 跑 **B4→B2→B3 順序斷言**——先用 positive fixture 確認回傳非空且含 `pii_fields`(fixture 失效=紅燈,非跳過),再驗無裸 PII、再驗 model 面已遮罩;② 沒標 `outputs.*.pii: true` 的 flow(無 `pii_fields`/`test_fixture`)**不跑非空斷言**,直接拿該 flow 既有的一般測試輸出過 PII detector,命中即紅燈(意外裸 PII 洩漏的安全網),沒命中就過,不因缺 fixture 被誤判失敗。CI 綠燈才算過。
- PII/secret detector:抽成共用模組,A2/A3/B2/B3 與 gitleaks 樣式庫共用。
- **C4(a)(b) adapter 契約測試**:對 `ctx.sheet`/`ctx.storage` adapter 本身(不是逐 workflow)寫五個單元測試(§2 C4(a) 已展開為四個 containment/快取測試,harness 落點同步列出,不能只做前兩個):① `touches.google_scope` 清單內 ID 本身可存取;② 清單內某 folder 底下的子檔案可存取(驗證 parent-chain containment,不是只驗表層 ID 相等);③ 清單外的 ID(含清單外 folder 底下的子檔案)一律拋 `PermissionError`;④ 批次存取同一 folder 下多個檔案時,API 呼叫次數不隨檔案數線性增長(驗證 containment 快取生效,防 N+1 rate-limit 問題);⑤ adapter public 方法簽名不得出現 `name_contains`/`search`/`query` 之類的模糊比對參數(型別檢查即可,不用跑內容掃描)。C4(c)(來源資料 schema 驗證)不在此列,留 CLAUDE.md 當人工 review checklist,見 §2 C4 列的誠實標註。
- ⚠️ **補一個合規的 positive-fixture 範例**:目前全 repo(即 clone 下來看得到的檔案)**唯一**合規範本是 `vibe-project-template/workflows/hello_world`(green、無 PII);`example/legacy_not_compliant/` 是 `.gitignore` 排除的本機私有素材(不隨 repo 發佈,新 clone 看不到),不能當「repo 內建範例」用,也不能假設實作者手上會有它。conformance harness 若沒有至少一個 yellow/red + 真實 `pii_fields`/`test_fixture` 的合規 workflow 可跑,B4→B2→B3 斷言鏈只能自測合成測資,無法佐證本節末「驗收標準」的宣稱。建議 M2 交付物內**在 repo 裡新建並 commit 一個** tracked 的合規範例(不要依賴本機才有的 legacy 素材當底稿,直接照 hello_world 的結構寫一個 yellow-tier 帶 PII 的範例)。

**M3(runtime,依賴平台)** — 光靠宣告會被繞過的那些,由權限/沙盒層兜底
- `ctx.*` adapter 落:B1 輸出硬限、C1/C2「非 `ctx` 不能碰資料/外界」的沙盒約束(`ctx.browser.new_page()` 豁免)、C3 egress allowlist(讀 `permissions.network.allow_hosts`)、D3 runtime 半徑、E3 run ledger。(A2/A3 對 `ctx.log`/`ctx.notify` 的遮罩已在 M2 做好,M3 conformance 只需驗證 `ctx.*` 全家族——含平台後續新增的 adapter——都經過同一遮罩管線,不重做遮罩邏輯本身;**`render_status.py` 不在此保證範圍內**,它的活路徑由 roadmap R5 另外追。)
- **D1 最小權限(load-bearing)**:**先把 `ctx.db` 從 `_NotYet` 佔位接上真 adapter**,再讓 agent 執行情境的 DB 連線限 read-only role / draft schema;生產寫入僅由已批准 executor 以另一組憑證執行。未宣告的直接寫入在權限層被擋。
- 對映 [docs/roadmap.md](docs/roadmap.md) 的平台化項目。

**驗收標準**:一個新 agent flow 專案,不看文件、只跑 `guard` + conformance harness,就能被正確判定 green/yellow/red 並擋下所有可**靜態/測試判定**的 A–E 違規(A1/B1/B2/B3/B4/C1/C4(a)(b)/D1-宣告/D2/E1/E2);而「宣告可繞過」的部分(D1 未宣告直寫、C2 繞 `ctx`、C3 未宣告 host)由 M3 runtime 權限/沙盒兜底;**C4(c)(來源資料 schema 驗證)與 E3(run ledger 完整性,補測試前)是目前唯二承認無法自動判定的例外**,不計入「不看文件也能被擋下」的保證。開發者要通過只能把設計改對,不能繞過。這就是「治理靠機器預設」的落地。

<!-- agy-peer-reviewed: rounds=3 verdict=approved (initial) -->
<!-- code-review + agy re-review: rounds=5 verdict=approved (6 spec-vs-repo mismatches fixed: tools[]→workflow model, redact/db flagged net-new, C3 egress field, ctx.browser.new_page, citations) -->
<!-- last-reviewed: 2026-08-22T16:35:01Z -->

<!-- agy-peer-reviewed: 2026-08-26T06:49:41Z rounds=5 verdict=approved (post-PR-review fixes: render_status/citation/TS-notify/C4-file-safety/E2-alert-redundancy/roadmap-mapping/E3-honesty fixed round1; then agy found+fixed 6 more real issues: A1 object loophole, B1 truncation boundary, B3/B4 project-vs-workflow scope, C4(a) missing PROJECT.yaml field then static-whitelist-breaks-dynamic-access then N+1 rate-limit, B2/§5 sync gaps) -->
