# kkday-vibe-framework 審查報告

> 審查日期:2026-08-20
> 審查範圍:`kkday-it/kkday-vibe-framework` @ master(全 repo:spec、vibe-project-template、platform_sdk py/ts、guard、registry、roadmap)
> 審查目標:① 符合 DevOps 上雲標準 ② vibe coding user 能快速上雲 ③ 好維運,出狀況能快速取到資訊

---

## 總評

方向與文件品質很高:`vibe-cloud-ready-spec.md` 有 why、有反模式表、有自我檢查清單、有交接清單;`PROJECT.yaml` + registry 的治理錨點設計正確;ctx.* 介面凍結 + typed error + guard CI 的三件組是對的骨架。

**核心問題:文件層已經 v1.0,實作層還在 v0.3,而且 template 參考實作示範了自己 spec 禁止的反模式。** 目前狀態:

- Template 開箱跑不起來(容器起不來、依賴缺、進入點合約不一致)
- 雲端主路徑(HTTP job)完全沒有失敗現場保全 → 出事拿不到資訊
- Public repo 洩漏內部 hostname 與風險地圖

AI agent 會照 template 抄,**template 錯 = 全公司錯**。以下依嚴重度列。

---

## 🔴 P0 — 必須先修

### P0-1. Public repo 洩漏內部資訊

**位置**:`registry/vibe-registry.md`、`registry/registry.yaml`

- `vibe-registry.md` 列出內部系統 hostname(`odoo.eip.kkday.net`、`be2.kkday.com`、`b2b.518fb.com`)+ 各專案風險等級與 PII 標記 — 等於公開「全公司 vibe coding 攻擊面地圖」
- `registry.yaml` 含個人本機絕對路徑 `/Users/lance.chien/...`

**修法**:
- [ ] Repo 轉 private,**或**把 registry 整個拆到 private repo,framework 本體留 public
- [ ] 清 git history 中已洩漏的內容(轉 private 後仍建議 scrub)
- [ ] `registry.yaml` 範例改用假路徑 / 假 repo 名

---

### P0-2. 容器起不來:CMD 指到不存在的 task

**位置**:`vibe-project-template/Dockerfile`、`run.sh`、`requirements.txt`

- `CMD ["./run.sh", "web"]` 但 run.sh 只有 `worker` / `run` 兩個 case → `unknown task: web`,exit 2
- `src/api.py` import Flask 與 platform_sdk,但 `requirements.txt` 只有 `pyyaml` → 兩者都裝不到
- `docker build && docker run` 第一步就死 → vibe user 第一次體驗即失敗

**修法**:
- [ ] run.sh 補 `web` task(exec gunicorn,見 P1-4)
- [ ] requirements.txt 補 `flask`、`gunicorn`,並交代 platform_sdk 安裝方式(見 P2-7)
- [ ] 加 CI 冒煙測試:`docker build` → `docker run` → curl `/health` → curl 觸發 hello_world(見 P2-5)

---

### P0-3. 三處進入點合約不一致,互相叫不到

**位置**:`platform_sdk/py/platform_sdk/runner.py`、`vibe-project-template/workflows/hello_world/flow.py`、`src/api.py`

| 元件 | 期望的進入點 |
|---|---|
| runner.py | `flow(ctx, **inputs)` — 找不到就拋 WorkflowError |
| hello_world/flow.py | 定義的是 `run(ctx, **kwargs)` |
| api.py | 呼叫 `module.run(ctx)` |

官方 runner 跑官方 hello_world 必定失敗。

**修法**:
- [ ] 三處統一為一個名字(建議 `run(ctx, **inputs)`,語意直觀)
- [ ] 合約寫進 `workflow-manifest.schema.json` 或 CLAUDE.md 公司共用段,凍結
- [ ] guard 加檢查:每個 workflow 的 flow.py 必須定義該進入點(AST import 檢查即可)

---

### P0-4. api.py 背景執行緒直接違反 spec §2.3

**位置**:`src/api.py` → `run_workflow_async()`

spec 明文:「回應送出後的『背景繼續做』不可靠(pod 可能立刻被回收)→ 一樣改成 job」。但 api.py 用 `threading.Thread(daemon=True)` 起背景執行緒後回 202:

- pod 縮容 / SIGTERM / rolling update 時工作直接蒸發,daemon thread 不等排空
- 不冪等:重複觸發 = 重複執行(違反 spec §2.7)
- 不回 `run_id`,caller 無法關聯這次執行

**修法**(照 spec §2.7 自己寫的形狀):
- [ ] 改為**同步、有界執行**:單次處理一批、5 分鐘內返回、回傳 JSON 摘要(處理數 / 失敗數 / run_id)
- [ ] 冪等設計:同一時間打兩次結果要正確(可用 DB advisory lock 或 run 去重)
- [ ] 回應包含 `run_id`

---

### P0-5. 雲端主路徑沒有「失敗三件套」→ 出事拿不到資訊

**位置**:`src/api.py` vs `platform_sdk/py/platform_sdk/runner.py`

失敗現場保全(截圖 + HTML + Slack 告警 + 狀態記錄)只存在於 runner.py(Dkron 路徑)。但 cloud-ready 主線是 **CronJob → `POST /api/jobs/<name>` → api.py**,而 api.py 自己 import module 直接呼叫,繞過 runner — **失敗時只有一行 `print`**。

這直接命中「萬一有狀況要能快速取到資訊」的核心訴求:目前雲上出事,什麼都拿不到。

**修法**:
- [ ] api.py 收斂為呼叫 `runner.run_workflow()`,讓所有進入點(本機 CLI / worker / HTTP job)共用同一套失敗處理
- [ ] runner 的失敗產物(截圖、HTML、summary)落點改 `/tmp` + 上傳 S3(見 P1-1),不能留本機

---

## 🟠 P1 — DevOps 合規細項(spec 有寫,實作沒跟上)

### P1-1. 寫檔位置違反「只能寫 /tmp」

- `LogManager` 寫 `runs/<run_id>.jsonl` 到**專案目錄**;runner 寫 `runs/*.summary.json` 同樣位置
- EKS 開 `readOnlyRootFilesystem` 直接 crash;pod 重啟 log 全失

**修法**:
- [ ] JSONL / summary 落點改 `/tmp`(env 可覆寫),並保持鏡射 stdout(結構化 JSON,一事件一行)
- [ ] run 結束時上傳 S3(`ctx.storage`),MVP 至少 stdout 要完整(平台 log pipeline 能收)

### P1-2. Dockerfile 不符 spec §2.1

- [ ] 改 multi-stage(build 階段裝依賴,runtime 只留產物)
- [ ] `COPY . .` 改為只 copy 需要的目錄(src/ workflows/ platform 產物),搭配 .dockerignore 補 `tests/`、`docs/`、`assets/`
- [ ] Python 版本統一:Dockerfile 用 3.10、guard.yml 用 3.11 → 擇一(建議 3.11+)

### P1-3. 依賴未鎖定

- [ ] `pyyaml>=6.0` 浮動版本 → 產 lockfile(`pip-compile` / `uv lock`),安裝走 `--require-hashes` 或等價
- [ ] platform_sdk 的 setup.py 依賴同樣加上限

### P1-4. 無 SIGTERM 排空

- [ ] Flask dev server(`app.run`)換 **gunicorn**(自帶 graceful shutdown,timeout 設 30–45s 對齊平台排空時間)
- [ ] run.sh `web` task = `exec gunicorn -b 0.0.0.0:${PORT:-8080} src.api:app`(exec 讓 PID 1 收得到 SIGTERM)

### P1-5. token 比對非常數時間(spec §2.6)

- [ ] `auth_header != f"Bearer {token}"` 改 `hmac.compare_digest`

### P1-6. secret 引用格式分裂 → 默默跑錯

- manifest 用 `secret://`、guard 兩種都放行,但 `SecretManager` 只認 `vault://`
- `secret://hello_world_api_key` 會被**整串當 env 變數名**去查 → 永遠查不到 → 默默 fallback 到 default(正是 spec 說要 fail fast 的坑)

**修法**:
- [ ] 統一為一種 scheme(建議 `vault://`),guard、manifest、SecretManager、hello_world 四處同步
- [ ] SecretManager 查不到且無 default 時 **raise**,不要回 None

### P1-7. Dkron 幽靈敘述未清

- roadmap R3/R10 與 CLAUDE.md 都說 Dkron 是 legacy/fallback,但 `run.sh` 註解、`worker.py` docstring 還在講 Dkron 派工
- AI agent 會同時讀到兩套世界觀

**修法**:
- [ ] run.sh / worker.py 的 Dkron 敘述改為 cloud-ready 主線用語(CronJob → HTTP endpoint),Dkron 相關搬進 roadmap R10 或標 `# legacy:`

### P1-8. guard 本身的 bug

- [ ] **死檢查**:`content.lower()` 之後比對大寫 `"CREATE TABLE"` → 永遠不會命中。pattern 全轉小寫
- [ ] **false positive**:`"localhost"` 裸 substring 掃全部 .py,註解 / docstring 提到就紅燈 → 至少排除註解與字串說明(或改 AST / 只掃非註解行)
- [ ] roadmap R2 與現狀不同步:R2 列的 Dockerfile 檢查部分已實作在 validate_project.py,更新 roadmap

### P1-9. 缺 db/migrations 骨架

- spec 花最大篇幅講 migration,但 template 沒有 `db/migrations/` 目錄與 `db:migrate` runner
- [ ] 補 `db/migrations/0001_baseline.sql` 範例 + 零依賴 migrate runner(advisory lock + schema_migrations 表,照 spec §2.5 描述實作)

### P1-10. .env.example 不完整

spec 要求「涵蓋程式讀到的每一個 env」,實際缺:
- [ ] `SLACK_WEBHOOK_URL`(runtime secret)
- [ ] `VIBE_STORAGE_PATH`(runtime plain)
- [ ] `VIBE_RUN_MODE`(runtime plain)

---

## 🟡 P2 — 三大目標補強建議

### 維運 / 快速取到資訊(目前最大缺口)

**P2-1. run 狀態要有可查落點**
- [ ] MVP:run summary 寫 stdout JSON + 回傳 `run_id` 給 caller
- [ ] 中期:進 PostgreSQL `runs` 表 — 這是 kill switch / rerun / audit viewer(R9)的地基

**P2-2. template 內建 run 查詢 endpoint**
- [ ] `GET /api/runs?workflow=<id>&limit=20`:最近 N 次執行的狀態、耗時、錯誤類型、失敗在哪個 step
- 出事第一個問題永遠是「上次成功是何時、這次死在哪步」— `ctx.log.step` 的結構已支撐得起

**P2-3. 版本可觀測**
- [ ] `/health` 回應加 `git_sha`(build-arg 注入,非 secret)→ 回滾時秒確認「現在跑的是哪版」

**P2-4. PII masking 名實不符**
- CLAUDE.md 宣稱 `ctx.log` 是 "masked structured audit log",但 LogManager **沒有任何 masking**
- [ ] 二擇一:做最小版 masking(email / 電話 / token regex),**或**文件改為「masking 尚未實作,寫 log 前自行遮罩」
- 不能讓 AI agent 以為框架會兜底

### 快速上雲體驗

**P2-5. 開箱即跑變成 guard 的一部分**
- [ ] CI 加冒煙測試:`docker build` → `docker run` → curl `/health` → curl 觸發 hello_world → 驗證回 200 + run_id
- 防止 template 再次腐化

**P2-6. 本機一鍵起**
- [ ] 補 `docker-compose.yml`(app + postgres),vibe user 不用懂 DB 安裝

**P2-7. platform_sdk 安裝路徑要交代**
- kkday-connectors 未發佈,template 目前引不到 SDK
- [ ] 過渡期給明確指令,例:`pip install "git+https://github.com/kkday-it/kkday-vibe-framework#subdirectory=platform_sdk/py"`,寫進 template README 與 requirements 註解

### 治理對齊

**P2-8. 風險分級雙軌**
- `risk_tier: green|yellow|red` vs MCP governance 的 **L0–L3** 是兩套詞彙
- [ ] 統一,或明文 mapping(green≈L0/L1、yellow≈L2、red≈L3)寫進 project-template-v0.md

**P2-9. tests 檢查形同虛設**
- `hello_world/tests/test_flow.py` 只有 `pass`,guard 只檢查目錄存在
- [ ] 最低要求:dry-run 能 import flow 並以 mock ctx 呼叫成功

---

## 建議修復順序

| 順序 | 項目 | 對應 |
|---|---|---|
| 1 | Registry 內部資訊撤出 public repo(**今天**) | P0-1 |
| 2 | 進入點合約統一 + requirements 補齊 + run.sh 補 web → template 可跑 | P0-2, P0-3 |
| 3 | api.py 同步有界執行 + 收斂到 runner(失敗三件套上雲)+ compare_digest + 回 run_id | P0-4, P0-5, P1-5 |
| 4 | log/summary 落點改 /tmp + stdout,補 /api/runs | P1-1, P2-1, P2-2 |
| 5 | guard 修死檢查 + 加 docker 冒煙測試 | P1-8, P2-5 |
| 6 | 清 Dkron 敘述、統一 secret scheme、補 migrations 骨架、gunicorn、multi-stage | P1-2~4, P1-6, P1-7, P1-9 |

---

## 保留不動的(設計正確)

- `vibe-cloud-ready-spec.md` 作為憲法 + 文件衝突優先序(DevOps spec > 機器規則 > roadmap)
- `PROJECT.yaml` 治理錨點 + 主動申請制 registry(M0 先看見)
- ctx.* 介面凍結 + `NotYetImplemented` typed error(擋住 agent 繞道 import vendor SDK)
- `errors.py` 的 retryable 分類,特別是 `SubmittedUnknown` 絕不自動重試
- CLAUDE.md 公司共用段 / 專案自訂段的分段結構
- guard CI + gitleaks 的雙檢查
- checkpoint 分模式設計(interactive `--yes` / worker fail-fast,絕不 stdin 等待)

---

*一句話總結:骨架和哲學是對的,把 template 修到能通過自己 spec §5 的自我檢查清單,這個 framework 就能交付。*
