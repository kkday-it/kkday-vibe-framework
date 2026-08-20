# Enterprise Workflows 框架 v0.1 — 設計與運行企業級工作流的架構(2026-08-20)

> **定位(v0.1 起)**:一個專門用來**設計與運行企業級工作流(Enterprise Workflows)**的架構 —
> 對 DevOps/架構團隊用他們的既有心智模型溝通(觸發、步驟、排程、觀測),而非「vibe coding 管制」。
> 與現成品(Temporal/Windmill/n8n)的差異一句話:**治理內嵌**(contract/確認點/憑證/審計是一等公民)、
> **AI 生產線原生**(CLAUDE.md+ctx 讓 AI 直接產合格 workflow)、**零新增基礎設施**(全靠公司既有 Dkron/S3/vibefile)。
>
> 術語:v0.1 起「skill」一律改稱「**workflow**」(目錄 workflows/、contract 稱 workflow-contract);
> 內文引用的 `skill-contract-v0.md`(vibe-coding-governance/)即 workflow contract 的現行檔名。
>
> 層次:SOLUTION.md rev3 是「平台」(終局);本文件是「repo 層最小治理」(現在)。
> 產出物(workflows/)未來可直接上架平台,不用重寫。對齊 rev3 §5 M0-M1(零成本期)。

---

## 1. 一句話

一個 **GitHub template repo + 一支 scaffold 指令**:開新專案就長出標準結構、
治理身分證(PROJECT.yaml)、AI 開發規則(CLAUDE.md)、憑證規約與 CI 守門 —
「照模板開專案」比「自己亂長」更省事,治理才推得動(同 rev3 原則:降低合規摩擦力取勝)。

## 2. 標準 repo 結構

```
my-vibe-project/
├── PROJECT.yaml          # 專案身分證 — 治理錨點(見 §3)
├── README.md             # 這專案做什麼、怎麼跑、找誰
├── CLAUDE.md             # AI 開發規則:公司共用段(鎖定)+ 專案自訂段
├── src/                  # 程式碼(語言不限,結構內部自訂)
├── workflows/               # 可治理的積木,每顆照 skill-contract-v0 包
│   └── <workflow-name>/     #   manifest.yaml + flow + README + tests/
├── integrations/         # 對外串接的設定與 thin wrapper(見 §4),不放邏輯
├── assets/               # 圖片、靜態資源(產出物,如報告用圖)
├── docs/                 # 規劃、決策紀錄(ADR)、交接文件
├── scripts/              # 一次性/維運腳本(明確標注可否重跑)
├── tests/
├── run.sh                # 統一進入點:本機/CI/Dkron 都從這裡跑(見 §7)
├── requirements.txt      # 相依宣告(py 範本;js 專案為 package.json)
├── .env.example          # 只放 key 名與說明,永不放值
├── .gitignore            # 模板預帶:.env、*.key、credentials*、token*
└── .github/workflows/
    └── guard.yml         # 守門 CI(見 §9)
```

規則三條,其他放生:
1. **src 與 skills 分離**:src/ 是專案內部邏輯,workflows/ 是「有副作用、要被治理」的動作單元(打內部 API、操作外部網站、發訊息)。判斷法:這段程式碼掛掉或亂跑會不會影響別人/別的系統?會 → workflows/。workflows/ 內照 contract 只准用 `ctx.*`(平台 SDK 介面);**平台還沒上線,所以模板附 local shim**(見 §4.5),skill 今天就跑得動、日後上架不改一行 — 沒有 shim,「不用重寫」是空話。
2. **integrations/ 不寫業務邏輯**:只放連線設定與公司 connector 的引用,邏輯回到 src/ 或 workflows/。
3. **assets 與 docs 不進 src**:AI 生成的圖、報告、截圖一律 assets/,避免 repo 根目錄變垃圾場。

## 3. PROJECT.yaml — 專案身分證

對齊 skill contract 的思路:凡是平台(或未來的登錄冊 crawler)要知道的,寫在這裡,機器可讀。

```yaml
id: qa.booking-smoke            # <team>.<project>
owner: lance.chien              # 掛名 owner(人,非團隊帳號)
team: qa
status: active                  # active | archived
risk_tier: yellow               # green | yellow | red(判準同 rev3 §3)

# 這專案碰什麼 — 登錄冊掃這裡就知道全公司 vibe coding 版圖
touches:
  internal_apis: [product-service, order-service]
  external_sites: [thsr.com.tw]
  integrations: [slack, gmail]        # 用了哪些 connector(§4)
  databases: [vibe-db/qa-booking, replica/order-db:ro]   # 碰哪些庫、可寫或唯讀(§5)
  pii: false                          # 有碰客人個資 → 強制 yellow 以上

schedules: {}                   # 空 = 無排程;task→cron map,可多條(有排程=無人在場,升級審視)
# schedules:                    # 範例:一個專案多個排程任務
#   worker: "* * * * *"         #   事件驅動 worker(§7.5)
#   daily_report: "0 0 * * *"   #   純排程任務;task 名對應 run.sh <task>
```

- **綠區專案只要求這一個檔 + secret scan 過**,其他全自由(rev3:「框架能說出『這個不用管』才推得動」)。
- 登錄冊(rev3 L4)第一版 = 一支 script 掃全 org 的 PROJECT.yaml,零平台成本就有全公司 vibe coding 清單 — 這就是 M0「先看見」的 repo 版。

## 4. Slack / Gmail 等串接規約(核心治理點)

問題本質:200 人各自去申請 Slack bot token、Gmail OAuth,token 散落各 repo = 最大資安破口,也是最常見的 vibe coding 需求。解法分三級,現在做 A,平台化後升 B:

| 級 | 機制 | 時程 |
|---|---|---|
| A. 共用 connector 套件 | 公司包好的 `kkday-connectors`(py/js 各一):`send_slack(channel, msg)`、`send_mail(...)`。token 由套件從 env/vault 讀,呼叫端永遠碰不到值 | 現在,約 3 人日 |
| B. 正門 / MCP | 串接走 L1 正門或公司 MCP server(Slack MCP、Gmail MCP),scope 綁工具身分,審計歸屬自動 | 隨 rev3 M3+ |
| C. 禁止 | 個人 token 寫進 code、自建未登記 bot、直接 pip install slack_sdk 自己拿 token | 立即,CI 擋(§9) |

A 級細則:
- **Slack**:統一一隻公司 bot(如 `vibe-bot`),各專案只填 channel;發訊帶 footer 自動標注來源專案 id(審計歸屬)。DM 與跨 workspace 預設不開。
- **Gmail**:發信走共用 service account + 白名單寄件人;讀信(如收報表)個案申請,在 PROJECT.yaml 的 integrations 標注 `gmail:read` 且強制 yellow。
- **憑證**:一律 `vault://` 引用或平台注入的 env;`.env` 只存在本機、永不 commit(模板 .gitignore 已擋)。
- **使用範圍**:`kkday-connectors` 只准在 **src/** 直接呼叫;**workflows/ 內禁止直用** — skill 照 contract 只認 `ctx.*`,由 shim(§4.5)在底下包 connectors。否則今天寫的 skill 上平台就要重寫,違反 §1 承諾。

## 4.5 platform_sdk local shim — workflows/ 的執行底座

skill-contract-v0 規定 flow 只准透過 `ctx.*`(`ctx.secrets`、`ctx.browser`、`ctx.notify`、`ctx.checkpoint`…)碰外界,但 L3 平台還沒存在 — 沒有本地實作,照 contract 寫的 skill 今天一行都跑不起來,大家就會繞去 src/ 寫野生邏輯,治理歸零。所以模板必附 **local shim**(隨 `kkday-connectors` 套件發佈,如 `platform_sdk` module):

| ctx 介面 | local shim 實作 | 平台上線後 |
|---|---|---|
| `ctx.secrets.get(ref)` | 讀 vault(或過渡期 env),值不落地 | 平台注入 |
| `ctx.browser` | 本機/該台 server 的 headless Playwright | 受管瀏覽器池 |
| `ctx.notify(msg)` | 包 kkday-connectors 的 send_slack | 平台通知系統 |
| `ctx.checkpoint(preview)` | **分模式**:互動模式=印 preview + `--yes` 續跑;worker 模式(無人在場)=檢查狀態機 — 該 run 的多方參數已補齊(§7.5「參數即審核」)即視為已放行、自動通過,**否則立即 fail 該 run(typed error),絕不 stdin 等待掛死整條佇列** | 確認點引擎(放行人≠發起人) |

原則:**contract 介面凍結、實作可換** — skill 程式碼零修改,從 shim 換到平台只是換 runtime。shim 是純函式庫、無 server,約 3-5 人日(計入 §10)。

## 5. DB 規約

先分兩類,規則完全不同:

| | 公司資料(生產 DB) | 專案自有 state(執行紀錄、快取、結果) |
|---|---|---|
| 讀 | 唯讀帳號 + replica/SIT,憑證 vault 注入;**禁直連 prod 主庫** | 自由 |
| 寫 | **禁直寫**,一律走 API/正門,或包成 skill 過治理(同 rev3 紅區邏輯) | 自由,但見下方三條 |

專案自有 state 三條:
1. **DB 檔不進 git**(模板 .gitignore 預擋 `*.db` `*.sqlite*`);SQLite 可以用,但檔案必須放在**有備份的 volume**,不准裸放 EC2 根磁碟。
2. **建議用中央「vibe DB」**:共用 PostgreSQL,每專案一個 schema,連線資訊 vault 注入、自動備份、專案 archive 時可整 schema 匯出 — 免得 200 人各架各的沒人備份。新增基礎設施:vibe DB(RDS 或既有 PG 開 schema)+ vibe runner 上的 ingest/worker 行程(§7.5),無其他(§7 的 runner server 本就是框架 compute)。**分環境**:對齊公司環境開 sit/stage/prod 三套(至少 sit + prod 兩套),同一 schema 名跨環境對應;開發與測試預設連 sit,只有正式排程執行才由 vault 注入 prod 連線 — 同 rev3 的 Staging First 原則,程式碼裡永遠只有 schema 名,環境由注入決定。
3. **共用 DB 上的 migration 紀律**:只准從已 merge 的 main 跑 migration;啟動時 ensure(`ADD COLUMN IF NOT EXISTS`)這種輕量做法對 vibe 專案反而更穩。

PROJECT.yaml 對應:`touches.databases: [vibe-db/qa-booking, replica/order-db:ro]` — 登錄冊直接看得到誰碰了哪個庫、唯讀還是可寫。

## 6. 執行觀測 — 產出轉 HTML,免登 AWS terminal

載體用現成的:內部 MCP `kkday-development-tools` 的 **vibefile**(HTML 單檔 ≤10MB 上傳 → 內部分享連結;MCP 或 Web UI 皆可)。框架規約:

1. **凡是排程任務或跑超過幾分鐘的批次,必須產「狀態頁」**:run log + 進度 + 產出摘要 render 成 self-contained HTML → 上傳 vibefile → 連結貼 Slack。使用者點連結就看,不用登 AWS。
2. **準實時**:同路徑同檔名重傳**直接覆蓋原檔=同一連結**(已實測證實)——執行中每 N 分鐘重 render 重傳,HTML 加 `<meta http-equiv="refresh" content="60">`,就是輪詢式實時儀表板。真 streaming 留給平台期,這個做法零後端。實際路徑為 `share/<上傳者>/<folder>/<檔名>` — **個人 namespace**,所以框架的 `publish_vibefile` 統一由 runner 的服務帳號上傳,狀態頁連結不綁個人(人離職連結不失效),個人手動分享才用自己帳號。
3. **命名空間防併發互蓋**:`folder=專案id`、`filename=<run_id>.html` — 每次執行一頁,同專案多人同時觸發(§7.5 常態)不會互蓋。另發一頁 `index.html` 列出該專案近期 runs 連結;「固定連結看最新」由 index 頁滿足,不靠覆蓋單一 run 頁。**index 一律從 DB 全量重建**:vibe DB 是唯一事實、index 只是 view。重建時機兩個 — 事件驅動專案由 worker 每輪派工後重建(§7.5);純排程專案由 run wrapper(`run.sh` 底層的 shim lifecycle:開跑寫 run 記錄、結束更新狀態)在每次執行結束時重建 — 排程 run 的頁面因此一樣掛上 index,不會變孤兒頁。因為每次都是「從 DB 撈全量、產完整視圖」,即使兩個重建罕見地同時發生,誰後寫都是一份完整正確(至當下)的 index,競態最壞只是短暫舊視圖,永不丟資料。
4. **工具下放**:`kkday-connectors` 加一支 `publish_vibefile(html_path, folder=project_id, run_id=...)`;模板附一個 status renderer(吃 JSON run log 吐 HTML),AI 一句話就能接上。
5. **紅線**:vibefile 有雙重邊界 — 站台綁 **kkday Google 帳號登入**(SSO)+ bucket 僅辦公室網路 IP 可存取。但登入後**連結全公司持鏈者皆可開,無 per-project 授權** → 憑證、內部 token 絕不得出現在狀態頁;PII 也一樣,PROJECT.yaml `pii: true` 的專案狀態頁只准放統計不放明細(renderer 內建遮罩)— 「CS 才能看的退款明細」這種授權需求 vibefile 給不了,明細留在來源系統,狀態頁只放 run 結果與連結。
6. 檔案一年未異動自動刪 — 長期報告要留存的歸檔到 Confluence,vibefile 定位是「執行期觀測」。

## 7. 排程規約

排程 = 無人在場執行,是風險升級點(rev3 §3)。規則:**排程必須「宣告 + 統一落點」,禁止私有 cron**(個人筆電 crontab、沒人知道的 EC2 cron 一律不算數)。

落點:**統一走 Dkron**(公司既有排程系統),job 名帶專案 id — 集中可見、可手動觸發、不用自架。不用 GitHub Actions cron(實測排程會延遲,不可靠)。紅區寫入排程現階段**不開放無人在場寫入**,等平台確認點機制。

**控制權歸屬(誰管排程)**:排程「**宣告在 project repo、執行在中央排程器**」— owner 要改頻率/加任務/停排程,改自己 repo 的 PROJECT.yaml merge main 即生效,**沒有任何一步需要 DevOps 出手**;DevOps 只一次性提供基礎設施(Dkron namespace + runner),維運的是「排程器」不是「大家的排程」(如同維運 k8s 但不管 deployment 內容)。**排程不做在 container 內**(容器裡跑 crond/APScheduler 常駐):那是「私有 cron」的容器版 — 200 個常駐容器把資源/重啟/監控反而全丟給 DevOps、排程藏在容器裡登錄冊與審計全失效、容器內 cron 死掉不告警(行程活著、排程靜默停擺),與「跑掛必通知」直接衝突。也不做在 script 自己 sleep/loop(常駐行程掛掉=全部排程消失的單點)。

**Fallback(若 Dkron namespace 談不下來)**:排程器自架在 vibe runner 上(supercronic/cron 讀登錄冊彙總的 schedules),DevOps 只給機器、排程由框架自管 — owner 操作方式(改 PROJECT.yaml)一字不變,只是執行端從 Dkron 換成 runner 上的框架行程。

repo → Dkron 的橋(缺這段 schedule 欄位就只是裝飾):
1. **統一進入點**:每個專案根目錄必有 `run.sh`(模板附),Dkron executor 一律「clean checkout(pin 到 main 最新 commit)→ 裝 requirements.txt → 跑 `./run.sh <task>`」— 不管哪個專案、什麼語言,Dkron 只認這一種跑法。
2. **schedule 與 manifest 同步**:merge 進 main 時,deploy workflow(模板附 `deploy.yml`)做兩件事 — (a) 遍歷 PROJECT.yaml 的 `schedules` map,對每個 entry 呼叫 Dkron API 註冊/更新一個 job:job 名=`<專案id>.<task>`、執行命令帶入 `./run.sh <task>`;map 移除的 entry 對應刪 job — 一個專案可同時掛 worker(every-1-min)與多個純排程任務,不必為排程拆 repo;(b) 把 PROJECT.yaml 與 workflows/ 各 manifest(含 inputs schema、decided_by、notify、frontend_url 宣告)發佈給 registry — **不直連 DB**:打 ingest 的 `POST /admin/manifests`(deploy token 驗證),由 ingest 寫入 vibe DB。網路拓樸:GitHub Actions 雲端 runner 進不了內網,所以 `deploy.yml` 跑在**內網 CI runner**(公司既有 Woodpecker/Jenkins 或 GitHub self-hosted runner);純 repo 檢查的 guard.yml(§9)不碰內網,留在雲端 GHA。宣告即部署,人不碰 Dkron UI。
3. **執行機**:跑在指定的 vibe runner server(有 vault 存取、出口 IP 固定),不是開發者本機。runner 以**預建 base image 執行**(內含 Python/Node、Playwright 及其瀏覽器與系統層依賴 `playwright install --with-deps`、字型)— `requirements.txt` 只補 pip 層,OS 層依賴由 image 保證,`ctx.browser` 才跑得起來;image 由中央維護、定期重建。

排程任務四鐵則(模板 CLAUDE.md 內建,CI 檢查 1、4):
1. PROJECT.yaml 宣告 `schedules`(登錄冊看得到全公司在半夜跑什麼)。
2. 冪等可重跑 — 跑一半掛了重跑不會重複下單/重複發信。
3. 跑掛必通知:失敗 → Slack(走 connectors),不准靜默死亡。
4. 產 vibefile 狀態頁(§6)— 每次執行更新同一連結。

歸屬:排程綁 **team 不綁個人**(rev3 Team Ownership)— owner 離職排程不變殭屍。

## 7.5 多方參數決策與強權帳號(真實紅區形狀)

真實案例(訂單取消全額退款):OP 發起並決定供應商端變數(是否收手續費),CS 再決定客人端變數(取消原因/備註/退款金額)後才執行 — **變數由發起人以外的第二單位決定**,不是單純「一人發起一人放行」。現行做法:Power Automate 表單 OP 填 → tag 對應市場語系 CS 補齊 → 觸發。框架要收編這個形狀:

1. **參數分段宣告**:manifest 的 inputs 每個參數可標 `decided_by: <role>`(如 op/cs,角色非個人)。缺任何一段 = pending,不執行。
2. **「參數即審核」**:第二單位補參數的動作本身就是 approval — 比 skill contract 的 confirmation(放行人≠發起人)更強,一個機制同時滿足補值與放行,不必做兩套。
3. **執行狀態機**:`draft(OP 填)→ pending_cs(通知對應市場 CS)→ ready → run`。誰在哪段填了什麼,全記 audit log。
4. **強權帳號治理**:`rpa@kkday.com`(CS+OP 全權)這類帳號**只進 vault**,skill 經 `ctx.secrets` 取用,任何人不直接持有密碼。它是「執行身分」不是「歸屬身分」— 歸屬一律看狀態機記錄(發起人+各段決策人)。權限過大是已知債,平台期換 scope 化工具身分(rev3 身分交集原則)。
5. **網段與觸發介面**:觸發人員分佈各國辦公室/VPN 不同網段 → 執行一律 server 側(§7 vibe runner),觸發與補參數介面一律 web(表單/Slack),不依賴使用者本機網路。現行 Power Automate 表單可原樣沿用當前端 — **先換底(執行搬進框架),前端後換**,遷移零學習成本。

現階段窮人版落地,三個框架級元件(都不是各專案自寫):
- **ingest 薄服務(兼狀態機推進者)**:外部前端(Power Automate 是雲端 SaaS,不可能直寫內網 DB)提交與補填的唯一入口 — 單一 HTTP POST endpoint,**部署在 vibe runner server 上**(§7 既有的 compute,不新增機器;RDS 是託管服務,本就放不了應用),per-project token 驗證 + 照 registry 裡的 manifest inputs schema(§7 deploy 時發佈,不 clone repo)驗參。**狀態推進與通知也歸它**:發起寫入後,依 manifest 的 `decided_by` 檢查缺哪段 → 進 `pending_<role>` 並透過 connectors 發通知到 manifest 宣告的 channel(如 `notify: {cs: "#cs-<market>"}`)。**通知必須可行動**:manifest 宣告各 role 的前端連結模板 `frontend_url: "https://<form>/?run_id={run_id}&token={token}"`,ingest 發通知時代入 run_id 與該 role 的一次性 scoped token 成 magic link — CS 點連結開表單,run 上下文與授權都在 URL 裡,不用手查編號;第二方補填經該前端打回同一個 endpoint,ingest 補段、段齊自動轉 `ready`。前端(表單)只負責收 UI 輸入,零編排邏輯 — 換前端只換 frontend_url,不動流程。Slack 表單、Google Form、Power Automate 都打這個口。基礎設施:**新增 = vibe DB(RDS 或既有 PG 開 schema)+ vibe runner 上的 ingest/worker 行程,無第三件**(§5 同步適用)。
- **標準 worker(派工/執行分離,執行不逃出 Dkron)**:`kkday-connectors` 內建泛用 poller(`run.sh worker` 即啟動)。**worker 只做派工、不自己跑也不 fork**:讀 pending 表、row lock 撿 `ready`,對每個 run 經 **Dkron API 建立並觸發一次性 run job**(名=`<專案id>.run.<run_id>`,`@manually` + 立即觸發,命令=`./run.sh run --run-id=<id>`),然後重建 §6 index、秒級退出。效果:**每個 run 都是一等 Dkron 執行** — 集中可見、操作員可在 Dkron UI 直接停掉失控的 run、掛掉觸發 Dkron 告警,治理承諾(§7)對子執行同樣成立;若 fork 背景子行程,執行就逃出 Dkron(殺不掉、掛了無感),故禁止。並行度=同時在途的 run job 數,worker 派工時控制在 manifest `max_parallel`(預設 3)內 — 10 筆退款同時進來,3 筆並跑、其餘依序遞補;worker 本身每專案單飛(concurrency=forbid)且秒退,永不堵住下一輪輪詢。完成的一次性 job 由 worker 定期回收。開發者不寫任何佇列邏輯。
- **checkpoint 語意**(§4.5):worker 模式下由狀態機滿足 — 參數補齊即已放行,自動通過;未齊 fail fast,不掛起。

平台期確認點引擎取代 worker 與 ingest,skill 與 manifest 零修改 — 丟掉的只有框架元件,不是各專案的程式碼。

## 7.6 控制權歸屬總表(分工契約)

原則一句話:**owner 控宣告,中央控機制** — 專案在自己 repo 裡宣告要什麼(排程/憑證/名單/通知),框架把宣告變現實;中央維運機制本身,不代管任何專案的內容。

| 面向 | Owner(專案)控 | 中央(框架/DevOps)控 | 依據 |
|---|---|---|---|
| 排程 | `schedules` 宣告、頻率、啟停 | 排程器本身(Dkron/runner) | §7 |
| 觸發/重跑 | `initiators:` 名單 | token 簽發、magic link 機制 | §12-7 |
| 憑證 | 宣告需要哪些(`vault://` 引用) | 值、注入、輪替(owner 永不持值) | §4 |
| 通知路由 | team channel、frontend_url | 統一 bot、發送機制 | §4/§7.5 |
| 專案資料 | 自己 schema 的資料與清理 | DB 本身、備份、環境注入 | §5 |
| 部署生效 | merge main 的時機 | deploy 同步機制 | §7 |
| **紅區上線審核** | 發 PR | **黃/紅區 workflow 的 PR 需框架組(curator)一枚 approve**(CODEOWNERS 實作);綠區 team 自審(建議,待拍板) | rev3「人審一關」 |
| **緊急停用(kill switch)** | 可隨時停自己的排程/run | **中央(框架組+排程器管理員)有無條件停用權**(停 job/撤 token),事後通知 owner(建議,待拍板) | 事故處置 |
| **資源配額** | `max_parallel`(cap 5) | 全域並發上限與排隊、紅區優先級 | runner 保護 |
| **規約防篡改** | 專案自訂段自由 | CLAUDE.md 公司共用段由 guard CI 驗 hash,改了紅燈(待實作) | §8/§9 |
| 套件版本 | pin kkday-connectors minor 版 | breaking change 提前公告+棄用期 | 維運節奏 |
| 殭屍回收 | `status: archived` 自行退場 | 登錄冊掃 90 天無 run 且無人回應 → 中央停排程標 archived | 登錄冊 |

## 8. CLAUDE.md 範本 — 讓 AI 產出物長一樣

模板附一份兩段式 CLAUDE.md:
- **公司共用段**(scaffold 生成,標注勿改):資料夾規約(§2 三條)、憑證鐵則(只准 vault/env 引用)、串接鐵則(只准用 kkday-connectors,禁自申 token)、有副作用的動作寫成 skill 包。
- **專案自訂段**:留白給各專案寫自己的 domain 規則。

效果:vibe coding 的「生產工具」(Claude/Cursor)自己就會遵守框架,不靠人記得 — 機制執行,不用善意執行。

## 9. 守門 CI(guard.yml,模板預帶)

1. **gitleaks** secret scanning — 擋 token/key 入庫(C 級禁令的機器執行)。
2. **PROJECT.yaml schema 驗證** — 缺身分證或欄位不合法就紅燈。
3. **workflows/ manifest 驗證** — 有 workflows/ 就照 skill-contract-v0 檢查(dry_run 用例存在、credentials 只有 vault 引用)。
4. **禁用套件檢查** — lockfile 出現 slack_sdk/google-api-python-client 直連而未經 connectors 白名單 → 警告(黃紅區升為紅燈)。

四項全零後端、純 GitHub Actions,綠區專案跑完 < 1 分鐘。

## 10. 落地(對齊 rev3 里程碑)

1. **週 0-1**:建 `vibe-project-template` GitHub template repo(結構+CLAUDE.md+guard.yml+run.sh/deploy.yml)+ `kkday-connectors` 的 Slack 發訊 + platform_sdk shim 最小版(§4.5:secrets/notify 先行)。約 8-10 人日。
2. **週 1-2**:登錄冊 script(掃 PROJECT.yaml 出全公司清單)+ 拿現存 vibe 專案做遷移示範(before/after:搬完少管了什麼)。現成樣本三件:`insurance_gui_date_picker.py`(桌面 GUI+帳密 hardcode 設定區+外站 Selenium,野生典型)、`kkday-ticket-bot`(平鋪結構)、`kkday-vibe-llm-wiki`(已有 AGENTS.md/.env.example,最接近規範,示範「補 PROJECT.yaml 就合規」的輕量路徑)。
3. **週 3**:併入 rev3 M1 PoC demo — 平台故事(終局)+ 模板故事(今天就能領)一起講,CTO 的「既定框架」有立即可發放的實體。
4. **推行分級**:新專案一律從模板開;存量專案只要求補 PROJECT.yaml + 過 secret scan(黃紅區才要求搬結構)。不強制遷移綠區(rev3 原則)。

## 11. 未定點(要人拍板)

1. connectors 套件由誰 own?(建議:中央框架組,domain 團隊貢獻 — 同 L1 正門 owner 邏輯)
2. Slack 統一 bot 的授權 + Dkron 給 vibe 專案的 namespace/權限(都需 IT/資安一次性核可)。
3. **vibe DB + vibe runner**:DB 新開 RDS 還是既有 PG 開 schema?環境開幾套(sit/stage/prod 全開或先 sit+prod)?runner server(跑 Dkron 任務+ingest+worker)機器與 vault 存取由誰批、誰 own?(§5/§7/§7.5)
4. 存量專案盤點:自願登記 vs org-wide 掃描(後者需 GitHub org admin 權限);connectors 首發語言 py 先或 py+js 同發。
5. 多方參數(§7.5)的填寫前端:沿用 Power Automate 表單當過渡(打 ingest)vs 直接做簡易 web form?
6. vibefile 供框架上傳用的**服務帳號**(§6.2:狀態頁不綁個人 namespace)向 kkday-development-tools 團隊申請。

---
相關材料:`../vibe-coding-governance/SOLUTION.md`(rev3 canonical)· `../vibe-coding-governance/workflow-contract-v0.md`(workflows/ 內每個積木的規格,原名 skill-contract-v0)

## 12. v0.1 決策附錄(2026-08-20 grill 定案)

1. **資料三層分工**:vibe DB=執行狀態與結構化紀錄(source of truth,機器用);S3=檔案類產出(報表/憑證/截圖);Google Sheet/Drive=給人看的**匯出視圖**(單向導出,不是資料庫,壞了可從 DB 重導)。ctx 對應:`ctx.db` / `ctx.storage.put()` / `ctx.sheet.export()`。
2. **log 規格**:框架 logger 統一 **JSONL**(每行 ts/run_id/workflow/step/level/msg/data),執行中寫本機、結束上傳 S3;vibe DB 只存 run 摘要(狀態/起訖/關鍵指標/log 檔連結)。查異常動線:狀態頁 → 步驟時間軸 → 原始 JSONL。介面:`with ctx.log.step("login"):`。未來接 Kibana 直接吃 JSONL。
3. **失敗三件套**(框架自動,專案零程式碼):① browser 型失敗瞬間截圖+存最後 HTML 進 S3;② Slack 告警打 team channel(workflow/步驟/錯誤一句話/狀態頁連結);③ 狀態頁頂部顯示失敗步驟+重跑指引。**不自動 retry**(寫入型重試風險高,人判斷後一鍵重跑;contract 的 never_on 照舊)。
4. **Google 三兄弟身分**:共用 **service account + Shared Drive**(每專案一個資料夾,檔案擁有權歸 SA 不綁個人);Gmail 發信 SA+白名單寄件人;**不做 domain-wide delegation**(全域金鑰債)、禁個人 OAuth。**拿錯檔案三重防呆**:① SA 全公司共用,但 shim 注入 ctx.sheet/ctx.storage 時綁死該專案的資料夾 ID(來自 PROJECT.yaml)— 跨專案越權做不出來,這也是 workflows 禁直用 Google SDK 的原因;② 找檔一律 file ID/固定路徑,禁檔名模糊搜尋(同名檔坑);③ 人放錯檔框架擋不了 — workflow 吃檔前驗 schema(欄位/筆數/日期合理性),不對 typed error 停下,紅區加 dry-run 預覽讓人看一眼再放行。
5. **AI 揭露面**:單一真相檔 — 模板 CLAUDE.md 公司共用段內嵌「**ctx 能力速查表**」(每個 ctx.* 一行:簽名+用途+範例),隨 kkday-connectors 版本更新。AI 讀一個檔就有完整世界觀。
6. **瀏覽器引擎收斂 Playwright**:ctx.browser 介面凍結,引擎統一 Playwright(auto-wait/headless 原生/trace 錄製餵失敗三件套);現有 platform_sdk MVP(Selenium)與三個 example 改寫列入 backlog — 趁樣本少改最便宜。
7. **觸發/重跑權限 token+名單制**:PROJECT.yaml 新增 `initiators:` 角色名單,ingest 驗 per-project token 也驗發起人身分;失敗告警內附**一次性重跑 magic link**(限 team 成員),重跑=建新 run 引用原 run(審計鏈完整);Dkron UI 只給管理員。
8. **保留政策與版本回滾:未定**,列入 §11 待拍板(等 DevOps/架構團隊接手時一起決)。

**platform_sdk MVP 已知落差(backlog)**:SecretManager 讀 env/.env(規格=vault)、notify 只印 log(規格=Slack)、Browser 為 Selenium 且未 headless(決策 6=Playwright headless)、ctx.db/ctx.storage/ctx.sheet/ctx.log.step 未實作。介面先行、實作補齊,不影響 workflow 程式碼。

<!-- agy-peer-reviewed: 2026-08-19T05:45:01Z rounds=9 verdict=approved -->
