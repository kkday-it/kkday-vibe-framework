# kkday-go-scheduling 上雲遷移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## 🔴 定案流程（2026-09-08，讀這段；覆蓋下方舊 Phase 敘述）
> **不做「先把舊版容器化」的丟棄工，一次建對的東西。** 5 步：
> ```
> ① G0：Supabase dump（盡快·最高優先·Cathy）— 搞清楚 Supabase 做了哪些事
> ② 照規範重構（去 Supabase）— 用 dump 結果建符合 vibe-cloud-ready-spec 的版本
>       形狀：不拆前後端、不用 FastAPI、一個 docker-compose
> ③ compose 確定能動 — 起來的是「重構後」的版本
> ④ 帶入基本資料 — 本機 Postgres 灌 sample data
> ⑤ UAT — 本機重構版 + sample data 上驗（不碰正式 Supabase，安全）
> ```
> - **關鍵相依**：② 重構卡在 ① dump（沒 dump 出 RPC/RLS/scan 邏輯就無法重建）。
> - **重構的細部任務要等 G0 出料才寫得出真 code**（Supabase 黑盒）→ 本文件現在只到 roadmap 級 + 可複用工程片段；G0 完成後展開 ② 的 bite-sized 細計畫。
> - 「維持現況連 Supabase」不是目標，只有 ③ 的過渡期為了先能跑可暫時連。

**Goal:** 依 5 步流程把 kkday-go-scheduling **去 Supabase、照 `vibe-cloud-ready-spec` 重構**，最終能在本機 `docker compose` 跑起來、帶 sample data、通過 UAT。**G0 dump 為最高優先**（重構全卡在它）。

**Architecture:** 新 repo `kkday-it/kkday-vibe-go-scheduling`（`vibe-project-template` 起手；現行不動、平行）。**一個 docker-compose**（不拆前後端、不用 FastAPI）：前端 + 批次 dispatcher + **本機 Postgres**（重構後資料落這、灌 sample data）。排程日後 ArgoCD/GitOps → CronJob。重構的資料層/認證/Realtime 替代做法**依 G0 dump 結果定**（非 FastAPI）。

**Tech Stack:** Python 3.11 / OR-Tools / React 18 + Vite 5 / nginx / Docker / PostgreSQL（本機）。（不含 FastAPI。）

> 下方「Phase 1 容器化現有系統（維持 Supabase）」「選項 A 前後端分離 / 三 image / 直連 RDS」是**舊路線**，已被 5 步流程取代；其中的**工程片段**（批次 dispatcher、`.env` 守門、dry-run 保險、Dockerfile、非 root/唯讀）**在 ② 重構時可複用**，保留參考。以本段與 §0 為準。

## Global Constraints

（每個任務的要求都隱含這一節，數值逐字取自 spec。）

- 容器**非 root 執行**，檔案系統假設唯讀、只有 `/tmp` 可寫。
- base image **釘 major**，不用 `latest`；lockfile 進版控、安裝用 frozen 旗標。
- **build 過程不用任何 secret、不連內網**。
- secret **只在 runtime 注入**；不進 image、不進 bundle、不進版控。
- 缺必要 env **啟動就大聲失敗並列出缺哪幾個**，不 fallback 回硬寫值；**空字串當「沒設」**（trim 後空即缺）。
- log 只寫 **stdout/stderr**，不寫 log 檔；不含 token / 密碼 / 完整個資。
- A 型服務綁 **`0.0.0.0`**、監聽 `PORT`、`/health` **不查 DB / 外部 / 不需登入**。
- B 型批次**跑完即止**、`restart: "no"`（叢集 `backoffLimit: 0`）、ENTRYPOINT 用 tini、工作名用 **`args:` 傳**。
- DB 連線：**公司內網、不強制 SSL**（DevOps 2026-09-08）→ sslmode 非爭點；重構後直連本機/RDS Postgres 若用 SSL，psycopg 用 `sslmode=require`（`no-verify` 是 Node 系用語、libpq 不接受）。
- schema 變更走 `db/migrations/NNNN_*.sql`：**forward-only、additive、已套用永不改**、單一 transaction。
- 對外送出開關（發 Slack / 通知）**預設關**、寫在 compose/CronJob env 看得見處，**不放 `.env`**。
- repo / image 名**全小寫 kebab-case**（本專案：`kkday-vibe-go-scheduling`）。
- 時間全程 **UTC 存**，商業邏輯**顯式帶時區**，不靠系統 local time；排程**盡量排上班時段**（DevOps 2026-09-08）。`dispatch-notifications`：讀 code 後確認是**佇列沖出器、時區為 display 端**、廣播非 ping → **寬工作窗（如 07:00–21:00）即可，不需夜間 CronJob**；唯一待 G0 確認＝前端動作是否即時塞事件型通知。
- 雲端資源用 **SDK 預設憑證鏈**（IRSA），程式內零 key。

---

## 流程總覽（5 步）

```
① G0 · Supabase dump            盡快·最高優先·Cathy      → 交付：supabase-export/（見 G0-EXPORT-GUIDE）
        │ （② 卡在這；沒料無法重建）
        ▼
② 照規範重構（去 Supabase）      需 ①·主要工程          → 依 dump 建符合 spec 的版本
        │  形狀：不拆前後端 / 不用 FastAPI / 一個 compose；細部任務待 ① 出料才展開
        ▼
③ compose 確定能動              重構版起來              → docker compose up 成功
        ▼
④ 帶入基本資料                  本機 Postgres seed      → sample data 灌好
        ▼
⑤ UAT                          本機重構版 + sample     → 安全（不碰正式 Supabase）
```

**執行規則：** **① G0 立即開始、最高優先**（Cathy）。**② 重構的 bite-sized 細計畫等 ① dump 出料才寫得出真 code**（Supabase 內部是黑盒）——現在只到 roadmap 級。**③④⑤ 接在 ② 之後。** 下方舊 Phase 1–7 內容（容器化現有版 / 選項 A / FastAPI / RDS）**已被此流程取代**，其中工程片段可在 ② 複用，保留參考。

---

## G0 待盤點閘門（Supabase 匯出）

**這不是 coding 任務，是取得資料的前置。** 未完成前，任何「碰 Supabase 邏輯」的階段都估不了工、寫不出真步驟。

**要取得（沿用 design doc §6）：**
1. 完整 table schema DDL（`pg_dump --schema-only`）
2. 所有 RPC function body（含 `fn_scan_*` 四支、`fn_get_engine_*`、`fn_org_family`、`fn_get_task_fairness`）
3. RLS policies（授權權威來源）
4. Supabase Auth 設定（user 對應 / session）
5. Storage buckets（確認 `exportApi` / `ScheduleUpload` 是否用到）
6. Realtime 訂閱範圍（哪些表 / 事件）
7. Edge Function 原始碼 `trigger-task-engine`（唯一 Edge Function）＋ DB RPC `approve_staff_request`（通用核准流程，**非 Edge Function**、隨 `01_schema.sql` 匯出，照其邏輯實作後端 endpoint）
8. 其他 triggers / views / 同專案其他排程
9. 各表 row counts + 資料 dump

**負責人：PM Cathy**（2026-09-08 確認，會用 AI 協助執行 Supabase dump）；RD 端協助接收與落地驗證。
**完成條件：** 上述 1–9 全部落地成 repo 內可讀檔（schema/function/policy 存成文字檔備查）。
**驗證：** 用匯出的 schema 在一個空的本機 Postgres 重跑，能無錯建出完整結構；row counts 記錄留底。
**回滾：** 不適用（純取得，不改動線上）。
**取得方式：** Supabase 專案 access → `pg_dump --schema-only` + 匯出 function/policy/RLS/Edge Function。

---

## Phase 1：第一關 — 在新 repo 容器化現有元件（不依賴 G0，立即可做）

> 🔴 **在新 repo 進行（2026-09-08 定案）**：所有 Phase 1 檔案建在**新 repo `kkday-vibe-go-scheduling`**（從 `vibe-project-template` 起手）。原始碼（`src/`、四支 batch `.py`）**從現行 `kkday-go-scheduling` 複製過來**。**現行 repo 與其 Netlify/Supabase/GitHub Actions 一律不動、繼續營運。** 下方所有 `Modify` 指的是「複製進新 repo 後在新 repo 內改」，**不觸碰現行系統的任何檔案或 workflow**。

**Task 0（前置）：** 建新 repo `kkday-vibe-go-scheduling`（`vibe-project-template` 起手），把現行 repo 的 `src/`、`scheduling_engine.py`、`task_engine.py`、`dispatch_notifications.py`、`backfill_slack_ids.py`、`package.json`、`index.html`、`vite.config.js` 複製進來。之後各 Task 在新 repo 內進行。

**目標：** 讓 `docker compose` 就能在本機把批次與前端叫起來，所有參數在 `.env`，行為與現在一致（批次仍連 Supabase，只是改成容器跑）。這一階段**不改任何業務邏輯**，只做容器化與設定衛生 —— 是風險最低、最先能過驗收的一塊。

> 後端 image 尚不存在（後端在 Phase 3 才建），故 Phase 1 的容器化只涵蓋 **batch** 與 **frontend**。

### 檔案結構（Phase 1 新增／修改）

- Create: `requirements.txt` — 批次 Python 依賴，釘版本
- Create: `batch/__init__.py`、`batch/main.py` — 統一 dispatcher（不帶參數列工作）
- Create: `batch/jobs.py` — 工作名 → 現有 script entry 的對應表
- Modify: `dispatch_notifications.py` — 加 `NOTIFY_DRY_RUN` 保險、netlify URL 改讀 `APP_BASE_URL`
- Create: `Dockerfile.batch` — B 型批次映像（tini + 非 root）
- Create: `Dockerfile.frontend` — 前端 nginx 靜態映像（multi-stage）
- Create: `nginx.conf` — 含 `/health` 與 SPA fallback
- Create: `.dockerignore`
- Create: `compose.yml` — batch(B) / frontend(A) / 本機 postgres
- Modify: `.env.example` — 補全所有 env + 分類註記
- Create: `tests/test_env_example.py` — `.env.example` 守門測試
- Modify: `.gitignore` — 補 `.env*` 白名單、`compose.override.yml`
- Create: `README.md` — 本機怎麼跑 + 部署備註 + 外部 host 清單

### Task 1：批次依賴 lockfile + 測試環境

**Files:**
- Create: `requirements.txt`（runtime）
- Create: `requirements-dev.txt`（測試）
- Create: `constraints.txt`（transitive 完整釘版，peer-review MED-7）

**Interfaces:**
- Produces: 供 `Dockerfile.batch` 用 `pip install -r requirements.txt -c constraints.txt` 安裝；本地驗證統一用 `.venv` 且含 pytest。

> peer-review MED-7：只釘兩個直接依賴不是完整 lockfile（transitive 仍由 pip 當次解析）；且驗證步驟建的 venv 沒裝 pytest，後續卻跑 pytest。以下修正：加 `requirements-dev.txt`（pytest）、加 `constraints.txt` 完整釘 transitive、所有驗證統一用同一個 `.venv`。

- [ ] **Step 1: 建立 requirements.txt（runtime 直接依賴）**

依現有 workflow 的 `ortools==9.10.4067 requests==2.32.3`，經 grep 確認四支 script 只 import `ortools` 與 `requests`：

```
ortools==9.10.4067
requests==2.32.3
```

- [ ] **Step 2: 建立 requirements-dev.txt（測試依賴）**

```
-r requirements.txt
pytest==8.3.3
```

- [ ] **Step 3: 產生完整 transitive 釘版 constraints.txt**

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip freeze > constraints.txt
```
（`constraints.txt` 進版控；Dockerfile 用 `pip install -r requirements.txt -c constraints.txt` 取得可重現安裝。）

- [ ] **Step 4: 安裝測試依賴並驗證環境**

Run: `.venv/bin/pip install -r requirements-dev.txt && .venv/bin/pytest --version`
Expected: 成功安裝、印出 pytest 版本。**後續所有 Task 的 pytest 一律用 `.venv/bin/pytest`。**

- [ ] **Step 5: 確認 .venv 已 gitignore**

Run: `grep -q '^\.venv' .gitignore || echo '.venv/' >> .gitignore`

- [ ] **Step 6: Commit**

```bash
git add requirements.txt requirements-dev.txt constraints.txt .gitignore
git commit -m "build: 批次依賴進版控（runtime/dev/constraints 完整釘版）"
```

### Task 2：批次統一 dispatcher

**Files:**
- Create: `batch/__init__.py`
- Create: `batch/jobs.py`
- Create: `batch/main.py`
- Test: `tests/test_batch_dispatcher.py`

**Interfaces:**
- Consumes: 現有 `scheduling_engine.py` / `task_engine.py` / `dispatch_notifications.py` / `backfill_slack_ids.py`（維持原檔、原 `argparse`），scan 四支現階段仍由 curl RPC（Phase 4 才搬 Python，此處先不納入 dispatcher，僅列於清單提示）。
- Produces: `python -m batch.main` 不帶參數印工作清單；`python -m batch.main <job> [args...]` 跑一支。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_batch_dispatcher.py
import subprocess, sys

def test_no_args_lists_jobs():
    r = subprocess.run([sys.executable, "-m", "batch.main"],
                       capture_output=True, text=True)
    assert r.returncode == 0
    for name in ["schedule-engine", "task-engine",
                 "dispatch-notifications", "backfill-slack-ids"]:
        assert name in r.stdout

def test_unknown_job_fails_loud():
    r = subprocess.run([sys.executable, "-m", "batch.main", "nope"],
                       capture_output=True, text=True)
    assert r.returncode != 0
    assert "nope" in (r.stdout + r.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_batch_dispatcher.py -v`
Expected: FAIL（`No module named batch`）

- [ ] **Step 3: 建 batch/__init__.py（空檔）與 jobs.py**

```python
# batch/jobs.py
"""工作名 → (module, [argv 前綴])。dispatcher 把剩餘 argv 接在後面轉呼叫。"""
JOBS = {
    "schedule-engine":        ("scheduling_engine", []),
    "task-engine":            ("task_engine", []),
    "dispatch-notifications": ("dispatch_notifications", []),
    "backfill-slack-ids":     ("backfill_slack_ids", []),
    # scan-c4 / scan-f1a / scan-f1b / scan-publish：Phase 4 搬成 Python 後納入
}
```

- [ ] **Step 4: 寫 batch/main.py**

```python
# batch/main.py
import runpy, sys
from batch.jobs import JOBS

def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print("可跑的工作（用法：python -m batch.main <工作名> [參數...]）：")
        for name in JOBS:
            print(f"  {name}")
        return 0
    job = argv[0]
    if job not in JOBS:
        print(f"未知工作：{job}。可跑：{', '.join(JOBS)}", file=sys.stderr)
        return 2
    module, prefix = JOBS[job]
    sys.argv = [module] + prefix + argv[1:]
    runpy.run_module(module, run_name="__main__")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_batch_dispatcher.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add batch/ tests/test_batch_dispatcher.py
git commit -m "feat: 批次統一 dispatcher（不帶參數列工作）"
```

### Task 3：對外送出保險 + netlify URL 去硬寫

> **peer-review 修正（3 個 HIGH）**：
> - **HIGH-2 回傳型別**：`slack_post_message` 現回 **tuple** `(ok, data)`（見 `dispatch_notifications.py:409`），呼叫端 `:460` / `:530` 都 `ok, resp = ...`。dry-run 若 `return False` → 解包 TypeError → 通知被誤標 failed、脫離 pending。→ dry-run 必須**回 tuple 且讓呼叫端跳過台帳更新（保持 pending）**。
> - **HIGH-2 台帳污染**：dry-run 不能走 `if ok:` 的 success 寫入，也不能走 failed。→ 回 `(None, {"dry_run": True})`，兩個呼叫端偵測到就 `continue`、不動台帳。
> - **HIGH-3 module-level 執行**：netlify URL 在**模組層 `TEMPLATES` 字典字面量**內（`:297`/`:312`）。改成呼叫函式會在 **import 時**執行、缺 env 直接 SystemExit（連 reload/測試都掛）。→ 改用 `{base_url}` 佔位、由 `render_message`（runtime）注入；fail-fast 移到 `main()` 開頭。
> - **新 repo 模型（2026-09-08）**：本 Task 改的是**新 repo 內複製過來的 `dispatch_notifications.py`**。現行 `kkday-go-scheduling` 的 dispatch 與其 GitHub Actions **完全不碰、照舊運行**（保留硬寫 netlify URL 也無妨，那是線上、不在本次範圍）。因此**不需要、也不可以**去改現行 workflow —— `APP_BASE_URL` 在新 repo 由 Phase 1 的 `compose.yml`、Phase 5 的 k8s CronJob env 提供。

**Files（皆在新 repo `kkday-vibe-go-scheduling`，複製自現行 repo）：**
- Modify: `dispatch_notifications.py`
- Test: `tests/test_dispatch_guards.py`

**Interfaces:**
- Consumes: env `NOTIFY_DRY_RUN`（trim 後空＝真發、非空＝dry-run）、`APP_BASE_URL`（新 repo 由 compose/CronJob env 提供）。
- Produces: `slack_post_message()` **恆回 2-tuple**；dry-run 回 `(None, {"dry_run": True})` 且不呼叫 Slack。`render_message()` 注入 `base_url`。`require_env()` 在 `main()` 開頭 fail-fast。

- [ ] **Step 1: Write the failing test（mock 掉 requests.post，RED 不打網路）**

```python
# tests/test_dispatch_guards.py
import importlib
import pytest

def _load(monkeypatch, **env):
    monkeypatch.setenv("SUPABASE_URL", "http://x")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setenv("SLACK_BOT_TOKEN", "t")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return importlib.reload(importlib.import_module("dispatch_notifications"))

def test_dry_run_skips_slack(monkeypatch):
    dn = _load(monkeypatch, NOTIFY_DRY_RUN="1", APP_BASE_URL="https://x.example")
    called = {"n": 0}
    monkeypatch.setattr(dn.requests, "post", lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    ok, resp = dn.slack_post_message("U1", "hi")
    assert called["n"] == 0             # 完全沒呼叫 Slack
    assert isinstance(resp, dict) and resp.get("dry_run") is True  # 契約：2-tuple、標 dry_run
    assert ok is None                   # None = 略過（非 success 非 failed）

def test_base_url_injected_into_template(monkeypatch):
    dn = _load(monkeypatch, APP_BASE_URL="https://sched.sit.example.com")
    msg = dn.render_message("G1", "zh-TW", {
        "month": "2026-06", "status": "OPTIMAL", "assignments": 10, "red_flags": 0, "run_id": 1})
    assert "kkday-go-scheduling.netlify.app" not in msg
    assert "https://sched.sit.example.com/engine-publish" in msg

def test_missing_base_url_fails_fast(monkeypatch):
    dn = _load(monkeypatch)             # 無 APP_BASE_URL
    with pytest.raises(SystemExit):
        dn.require_env()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_dispatch_guards.py -v`
Expected: FAIL（無 `require_env`、template 仍是 netlify、dry-run 未實作）

- [ ] **Step 3: 加模組層 env 讀取 + require_env（不在 import 退出）**

在既有 env 區塊（約 `:24–26`）後加：

```python
NOTIFY_DRY_RUN = os.environ.get("NOTIFY_DRY_RUN", "").strip() != ""
APP_BASE_URL = os.environ.get("APP_BASE_URL", "").strip()

def require_env():
    """dispatch 執行時才檢查（fail fast），不在 import 退出。"""
    required = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_KEY,
        "SLACK_BOT_TOKEN": SLACK_TOKEN,
        "APP_BASE_URL": APP_BASE_URL,
    }
    missing = [k for k, v in required.items() if not str(v).strip()]
    if missing:
        sys.exit(f"缺必要 env：{', '.join(missing)}")
```

- [ ] **Step 4: main() 開頭呼叫 require_env**

在 `def main():` 的第一行 `print(...)` 之後、`fetch_pending()` 之前插入：

```python
    require_env()
```

- [ ] **Step 5: 兩處模板 URL 改 {base_url} 佔位**

把 `TEMPLATES` 內 `:297`（G1）與 `:312`（G1_partial）的
`🔗 https://kkday-go-scheduling.netlify.app/engine-publish`
改成
`🔗 {base_url}/engine-publish`

- [ ] **Step 6: render_message 注入 base_url**

把 `render_message` 內 `return tmpl.format(**(template_vars or {}))` 改為：

```python
        fmt = {"base_url": APP_BASE_URL, **(template_vars or {})}
        return tmpl.format(**fmt)
```
（`except` 區塊維持不變。`base_url` 對不含該佔位的模板無害。）

- [ ] **Step 7: slack_post_message 加 dry-run（回 tuple、不打 Slack）**

在 `slack_post_message` 開頭加：

```python
    if NOTIFY_DRY_RUN:
        print(f"[NOTIFY_DRY_RUN] 略過 Slack → {slack_id}: {text[:60]}", flush=True)
        return None, {"dry_run": True}
```

- [ ] **Step 8: 兩個呼叫端偵測 dry_run 就跳過台帳更新**

`:460` 與 `:530` 的 `ok, resp = slack_post_message(...)` 之後、`if ok:` 之前，各插入：

```python
            if isinstance(resp, dict) and resp.get("dry_run"):
                print(f"   ⤼ #{log_id} {ntype} → DRY_RUN，未送、台帳保持 pending")
                continue
```

- [ ] **Step 9: APP_BASE_URL 由環境提供（不改任何現行 workflow）**

新 repo 內**不建 GitHub Actions workflow**（排程走 k8s CronJob）。`APP_BASE_URL` 在本機由 `compose.yml` 的 batch `environment:` 提供（見 Task 7），上雲後由 CronJob env / config-manager 注入。
🔴 **不要去改現行 `kkday-go-scheduling` 的 `.github/workflows/`** —— 那是正在營運的線上系統，本次遷移全程不碰。

- [ ] **Step 10: Run test + 全庫確認 netlify 硬寫清除**

Run: `.venv/bin/pytest tests/test_dispatch_guards.py -v`
Expected: PASS
Run: `grep -rn "netlify.app" *.py`
Expected: 無輸出（新 repo 內已無硬寫）。

- [ ] **Step 11: Commit**

```bash
git add dispatch_notifications.py tests/test_dispatch_guards.py
git commit -m "feat: 通知加 NOTIFY_DRY_RUN(不污染台帳)、URL 改 base_url 注入、main fail-fast"
```

### Task 4：`.env.example` 補全 + 守門測試

**Files:**
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `tests/test_env_example.py`

**Interfaces:**
- Produces: `.env.example` 涵蓋所有程式讀到的 env、值全空、每個標分類；守門測試防它過期。

> **peer-review 修正（MED-6）**：`ENGINE_ALERT_CHANNEL` / `NOTIFY_CHANNEL` **沒有任何 .py 讀取**（只在 GitHub workflow 的 shell curl 用，見 `scheduling-engine.yml:75`）。原本列進 `.env.example` 會被守門測試判 **orphan → 紅**。→ 移除（它是「會發東西」的告警頻道，屬 CronJob env allowlist，比照 `NOTIFY_DRY_RUN`）。另：guard 測試改 `rglob` 涵蓋 `batch/`、regex 涵蓋 `os.getenv`/`os.environ[]`、略過註解與 `.venv`。

- [ ] **Step 1: 重寫 .env.example（值全空、標分類）**

```
# ── runtime secret ──（config-manager 注入，改值+重啟即可）
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SLACK_BOT_TOKEN=

# ── runtime 非機密 ──
APP_BASE_URL=

# ── build-time 公開值（前端 bundle）──
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# 註1：NOTIFY_DRY_RUN 刻意不放這裡 —— 對外送出開關寫在 compose.yml/CronJob env（見 §1.6）
# 註2：ENGINE_ALERT_CHANNEL 是批次失敗告警頻道，目前只有 workflow shell 用、無 .py 讀取；
#      上雲後屬 CronJob env（allowlist），同樣不放 .env.example
```

- [ ] **Step 2: .gitignore 補白名單**

確認含：

```
.env*
!.env.example
compose.override.yml
```

- [ ] **Step 3: Write the guard test**

```python
# tests/test_env_example.py
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 環境自帶（CI/PORT）+ 刻意寫在 compose/CronJob env 而非 .env.example 的具名 allowlist
# （§1.6 對外送出開關 NOTIFY_DRY_RUN；ENGINE_ALERT_CHANNEL 告警頻道）
ALLOWLIST = {"CI", "PORT", "NOTIFY_DRY_RUN", "ENGINE_ALERT_CHANNEL"}
SKIP_DIRS = ("/.venv/", "/tests/", "/build/", "/node_modules/", "/dist/")

def _example_keys():
    keys = set()
    for line in (ROOT / ".env.example").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            keys.add(line.split("=", 1)[0])
    return keys

# 涵蓋 os.environ.get / os.getenv / os.environ["X"]；忽略註解行
_PY_PAT = re.compile(
    r"""os\.(?:environ\.get|getenv)\(\s*['"]([A-Z0-9_]+)['"]"""
    r"""|os\.environ\[\s*['"]([A-Z0-9_]+)['"]""")

def _read_keys():
    keys = set()
    for p in ROOT.rglob("*.py"):                       # rglob：涵蓋 batch/、shared/…
        if any(s in str(p) for s in SKIP_DIRS):
            continue
        for line in p.read_text().splitlines():
            if line.lstrip().startswith("#"):          # 略過註解
                continue
            for a, b in _PY_PAT.findall(line):
                keys.add(a or b)
    for p in (ROOT / "src").rglob("*.js*"):
        keys |= set(re.findall(r"import\.meta\.env\.([A-Z0-9_]+)", p.read_text()))
    return keys - ALLOWLIST

def test_every_read_env_is_listed():
    missing = _read_keys() - _example_keys()
    assert not missing, f".env.example 漏列程式讀到的 env：{missing}"

def test_no_orphan_keys():
    orphan = _example_keys() - _read_keys()
    assert not orphan, f".env.example 列了但沒程式讀：{orphan}"
```

- [ ] **Step 4: Run test**

Run: `python -m pytest tests/test_env_example.py -v`
Expected: PASS（若紅，補齊 `.env.example` 直到綠）

- [ ] **Step 5: Commit**

```bash
git add .env.example .gitignore tests/test_env_example.py
git commit -m "feat: .env.example 補全並加守門測試"
```

### Task 5：Dockerfile.batch（B 型、tini、非 root）

**Files:**
- Create: `Dockerfile.batch`
- Create: `.dockerignore`

**Interfaces:**
- Produces: image ENTRYPOINT 為 `tini -- python -m batch.main`，工作名由 `args`（compose 的 command / k8s 的 args）傳。

- [ ] **Step 1: 建 .dockerignore**

> **peer-review 修正（HIGH-1）**：共用 `.dockerignore` 不能排除 `src/` —— 前端 `Dockerfile.frontend` 走 `COPY . .` + `npm run build`，`index.html` 引用 `/src/main.jsx`，排掉 `src` 前端 build 必失敗。batch image 用**明確 `COPY` 指定檔**，`src` 本來就不會進 batch image（`.dockerignore` 只影響 build context 大小，不影響 batch 產物）→ 安全移除 `src`。

```
.git
node_modules
dist
.env*
!.env.example
docs
compose*.yml
compose.override.yml
.github
.venv
```

（不排除 `src`、`index.html`、`vite.config.js`、`package*.json`、`public/`：前端 build 需要。`tests/`、`*.md` 亦不排除以免與 rglob 守門測試/README 混淆判斷；它們不影響兩個 image 產物——batch 用明確 COPY、frontend build 只打包 `src` 匯入的內容。）

- [ ] **Step 2: 建 Dockerfile.batch**

```dockerfile
FROM python:3.11-slim
# tini 當 init 轉送 SIGTERM
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt
WORKDIR /app
COPY scheduling_engine.py task_engine.py dispatch_notifications.py backfill_slack_ids.py ./
COPY batch/ ./batch/
RUN useradd -u 10001 -m appuser
USER appuser
ENTRYPOINT ["tini", "--", "python", "-m", "batch.main"]
```

（用 `-c constraints.txt` 取得可重現安裝，對齊 Task 1 的完整釘版；不 `--upgrade pip` 以免引入非釘版行為。）

- [ ] **Step 3: build 驗證**

Run: `docker build -f Dockerfile.batch -t kkday-vibe-go-scheduling-batch:dev .`
Expected: build 成功。

- [ ] **Step 4: 不帶參數列工作驗證**

Run: `docker run --rm kkday-vibe-go-scheduling-batch:dev`
Expected: 印出 4 個工作名、exit 0。

- [ ] **Step 5: 非 root 驗證**

Run: `docker run --rm --entrypoint id kkday-vibe-go-scheduling-batch:dev`
Expected: `uid=10001(appuser)`，非 root。

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.batch .dockerignore
git commit -m "feat: Dockerfile.batch（B 型、tini、非 root）"
```

### Task 6：Dockerfile.frontend（nginx **非 root/唯讀**、multi-stage、/health）

> **peer-review 修正（HIGH-4）**：原本 `nginx:1.27-alpine` 以 root 跑、寫 `/var/cache/nginx`、`/var/run`，在叢集的非 root + 唯讀檔案系統下**起不來**——本機 `/health` 200 證明不了受限 pod 能啟動。→ 改用官方 **`nginxinc/nginx-unprivileged:1.27-alpine`**（以 uid 101 非 root 跑、預設 listen 8080、pid/temp 走 `/tmp`），並在驗證時加 `--read-only --tmpfs`。此改動同時解掉先前 LOW 的 PORT 缺口（unprivileged image 預設 8080）。

**Files:**
- Create: `Dockerfile.frontend`
- Create: `nginx.conf`

**Interfaces:**
- Consumes: build-arg `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（現階段前端仍連 Supabase，Phase 6 才改）。
- Produces: 非 root nginx 服 `dist/`，`GET /health` 回 200，SPA fallback，可在 `--read-only` 下啟動。

- [ ] **Step 1: 建 nginx.conf（server block，放進 conf.d）**

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    location = /health { return 200 "ok\n"; add_header Content-Type text/plain; }
    location / { try_files $uri $uri/ /index.html; }
}
```

（unprivileged base image 的主 `nginx.conf` 已把 `pid` 與各 `*_temp_path` 指到可寫位置；我們只覆寫這個 server block，不動主 conf。）

- [ ] **Step 2: 建 Dockerfile.frontend**

```dockerfile
# build 階段
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN npm run build
# runtime 階段（非 root、預設 8080）
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# 基底 image 已 USER 101（非 root），不需再指定
```

> 註：`package-lock.json` 目前不在版控（repo 無此檔）。**先產 lockfile**：`npm install --package-lock-only`，`npm ci` 才有依據。此步併入 Step 3。

- [ ] **Step 3: 產 lockfile 並 build**

```bash
npm install --package-lock-only
docker build -f Dockerfile.frontend \
  --build-arg VITE_SUPABASE_URL=http://placeholder \
  --build-arg VITE_SUPABASE_ANON_KEY=placeholder \
  -t kkday-vibe-go-scheduling-frontend:dev .
```
Expected: build 成功。

- [ ] **Step 4: 唯讀 + 非 root 啟動驗證（模擬叢集約束）**

```bash
docker run -d --rm -p 8080:8080 --name fe \
  --read-only --tmpfs /tmp --tmpfs /var/cache/nginx --tmpfs /var/run \
  kkday-vibe-go-scheduling-frontend:dev
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/health   # 期望 200
docker exec fe id                                                # 期望 uid=101，非 root
docker stop fe
```
Expected: `/health` 回 `200` 且在 `--read-only` 下正常；`id` 為非 root（uid=101）。

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.frontend nginx.conf package-lock.json
git commit -m "feat: Dockerfile.frontend（nginx-unprivileged 非 root/唯讀、/health、lockfile）"
```

### Task 7：compose.yml（batch + frontend + 本機 postgres）

**Files:**
- Create: `compose.yml`

**Interfaces:**
- Produces: `docker compose run --rm batch` 列工作；`docker compose up frontend` 起前端；本機 postgres 供 Phase 2 起用。

- [ ] **Step 1: 建 compose.yml**

```yaml
name: kkday-vibe-go-scheduling

services:
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        VITE_SUPABASE_URL: ${VITE_SUPABASE_URL}
        VITE_SUPABASE_ANON_KEY: ${VITE_SUPABASE_ANON_KEY}
    ports:
      - "8080:8080"
    restart: "no"

  batch:
    build:
      context: .
      dockerfile: Dockerfile.batch
    env_file:
      - .env
    environment:
      NOTIFY_DRY_RUN: "1"     # 一票否決：預設不對外送
    restart: "no"

  db:
    image: docker.io/library/postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devonly
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    restart: "no"
```

- [ ] **Step 2: batch 列工作驗證**

Run: `docker compose run --rm batch`
Expected: 印出工作清單、exit 0（NOTIFY_DRY_RUN 已預設關送出）。

- [ ] **Step 3: frontend health 驗證**

```bash
docker compose up -d frontend
curl -s -o /dev/null -w "%{http_code}" localhost:8080/health
docker compose down
```
Expected: `200`。

- [ ] **Step 4: Commit**

```bash
git add compose.yml
git commit -m "feat: compose.yml（batch/frontend/本機 postgres）"
```

### Task 8：README（本機怎麼跑 + 部署備註 + 外部 host）

**Files:**
- Create: `README.md`

- [ ] **Step 1: 寫 README.md**

至少含三段：
- **本機怎麼跑**：`cp .env.example .env` 填值 → `docker compose run --rm batch <工作名>` / `docker compose up frontend` → `/health` 驗證。
- **部署備註**：專案形狀（frontend=A 型、batch=B 型）；image 名 `-frontend`/`-batch`；排程需求表（每支 job 頻率／時段／單次耗時）。註：`dispatch` 是佇列沖出器、時區為 display 端 → **寬工作窗即可、不需夜間 CronJob**（見決策檔「通知機制真相」）；`scan-f1b` 播報移上班時段。（日後排程走 ArgoCD/GitOps。）
- **外部 host 清單（交平台確認 egress）**：`slack.com`、`accounts.google.com`、`oauth2.googleapis.com`、遷移過渡期 Supabase host。

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README 本機怎麼跑 + 部署備註 + 外部 host 清單"
```

### Phase 1 完成條件（對 §1.8 驗收清單）

- [ ] `.env.example` 涵蓋每個程式讀到的 env、值全空、標分類；守門測試綠
- [ ] `cp .env.example .env`（值空）→ `docker compose build` 成功、build 不用 secret
- [ ] batch 不帶參數印工作清單；`--read-only` 下非 root（uid=10001）
- [ ] frontend `curl /health` 回 200，且在 `--read-only --tmpfs` 下能啟動、非 root（uid=101）
- [ ] 缺必要 env 大聲失敗列缺項（Task 3 `require_env()` 在 dispatch `main()` 開頭）
- [ ] 全庫無硬寫 netlify URL（`grep -rn netlify.app *.py` 無輸出）
- [ ] 對外送出開關 `NOTIFY_DRY_RUN` 預設關、寫在 compose.yml 看得見處
- [ ] `docker compose down` 後再 up 行為一致

> **peer-review 註（MED-9）**：`/health` 200 只證明**靜態服務起得來**，不證明「有效設定下 app 可用」——空 `VITE_*` build 出的 bundle 仍會在瀏覽器載入時於 `src/lib/supabase.js:6` 拋錯。Phase 1 的 scope 就是「容器能起、參數在 env」，**app 端到端可用性留待 Phase 6 前端切換 + UAT**。此處刻意分開：「無 secret 可 build」與「有效設定可用」是兩件事。

### Phase 1 驗證方式

跑一次完整驗收腳本（可寫成 `scripts/verify_phase1.sh`）：build 兩個 image → batch 列工作（`--read-only`）→ frontend health 200（`--read-only --tmpfs`）→ `.venv/bin/pytest tests/ -v` 全綠 → `grep -rn netlify.app *.py` 無輸出。

### Phase 1 回滾方案

Phase 1 **不改業務邏輯、不動線上**（Netlify + GH Actions 照舊在跑）。新增檔案獨立、既有 script 僅 `dispatch_notifications.py` 有改動。回滾＝`git revert` 相關 commit；線上服務完全不受影響（本階段產物尚未接上任何部署）。

---

## Phase 2：schema 出土 + migrate runner + RDS baseline（需 G0）

**範圍：** 用 G0 匯出的 DDL 建 `db/migrations/0001_baseline.sql`；寫 `db:migrate` runner（advisory lock、`schema_migrations`、只跑沒記錄的、可重跑）；在 RDS 建空庫套用 baseline。
**完成條件：** 空 Postgres 跑一次 migrate 建出完整 schema；再跑一次不失敗；`schema_migrations` 有記錄。
**驗證：** 對 G0 匯出的 row-count 基準，比對 baseline 建出的表結構一致（`\d` 逐表）；migrate 冪等測試綠。
**回滾：** RDS 屬新建、與線上 Supabase 並存；回滾＝丟棄 RDS 測試庫，Supabase 不受影響。
**展開時機：** G0 完成後，另寫 `2026-XX-XX-phase2-schema-migration.md` 細計畫。

## Phase 3：後端 API 骨架 + Google OAuth/JWT + /health（**延後**）

> 🔴 **延後、且不走 FastAPI**（2026-09-08 定調）。以下為舊「選項 A」設計，保留作日後參考；近期不執行。

**（舊設計，背景）範圍：** ~~FastAPI 專案骨架~~、`/health`、Google OAuth + 自管 JWT、`auth.currentUser()` adapter、`Dockerfile.backend`。
**完成條件：** 後端容器起得來、`/health` 回 200；Google 登入走通拿到 JWT。
**回滾：** 後端與前端現況並存；停用 backend 部署，前端仍走 Supabase。
**展開時機：** 延後——去 Supabase 化時才重新規劃（後端框架另定，非 FastAPI）。

## Phase 4：資料存取層 + 逐塊 strangler（需 G0）

**範圍：** `shared/db.py`（直連 PG、TLS、小連線池、CRUD-only）；把 RPC/scan 邏輯逐支搬成 Python；把前端 121 處對應成後端 REST endpoint；RLS → 應用層授權。**逐塊搬、逐塊驗、逐塊可回退到 Supabase**。
**完成條件：** 每搬一塊，後端 endpoint 與原 Supabase 行為對數一致（同輸入同輸出）。
**驗證：** 對照測試（同查詢打 Supabase vs 打新後端，比對結果）；授權逐 endpoint 驗「誰能看什麼」。
**回滾：** strangler 特性 —— 每塊都有 feature flag / 路由開關，切回 Supabase 直連即可，不影響其他已搬塊。
**展開時機：** G0 完成後，按子域（排班/通知/掃描/…）各寫細計畫。

## G1：資料遷移與寫入切換閘門（HIGH-5，Phase 5/6/7 的硬前置）

> **peer-review 修正（HIGH-5）**：原計畫 Phase 2 只建**空** schema，之後 Phase 5/6 卻開始對 RDS 寫入，還宣稱「切 flag / 停 GH Actions / DNS 即可回 Supabase」。但**沒有初始資料匯入、增量同步、單一寫入來源、回切追平**——兩邊會分岔，「可回滾」不成立。且 Phase 5（批次寫 RDS）可能早於 Phase 6（前端仍寫 Supabase），造成**批次與使用者操作打不同資料庫**。以下把資料紀律變成正式閘門，Phase 5/6/7 任何「寫 RDS」的步驟都必須在此之後。

**核心原則：任何時刻只有一個「寫入正本」。** 平行運行期間，寫入正本要嘛是 Supabase、要嘛是 RDS，**不可兩邊同時收寫**。

**要做：**
1. **初始匯入 + 對帳**：Supabase dump → RDS，逐表 row-count 與抽樣欄位比對（延續 G0 的 row-count 基準）。
2. **單一寫入來源紀律**：定義每個階段「寫入正本」是誰；未切換的一方對另一方為唯讀複本。禁止「前端寫 Supabase、批次寫 RDS」的分裂窗口 → **Phase 5 批次寫 RDS 必須與 Phase 6 前端寫 RDS 綁同一個切換點**（或 Phase 5 先只讀 RDS、寫仍回 Supabase 直到總切換）。
3. **增量追平（採「短維護窗 + 最後同步」，2026-09-08 與 Cathy 議定）**：切換不採即時雙寫（兩獨立 DB 同時收寫必分岔），而是切換當下**短暫凍結舊系統寫入 ~15 分鐘 → 最後同步一次 Supabase→RDS → 驗證 → 切**，讓資料差異歸零而非「容忍一點點」。記錄追平起訖點。
   - 🔴 **關鍵資料一定要進最後那次同步**：**已核准的請假、已公佈的班表**——這類差一筆就會「有人以為請假過了其實沒有／看到錯班表」，不可容忍。偏好草稿等可容忍（大不了重填）。
4. **回切演練（rollback drill）**：切換前實際演練一次「RDS→Supabase 回切」，含把 RDS 期間新寫入的資料補回 Supabase 的機制；未演練過不得進 Phase 7 cutover。

**完成條件：** 初始匯入對帳一致；單一寫入來源在每階段明確且無分裂窗口；追平機制可運作；回切演練成功跑過一次。
**驗證：** 對帳報告（row-count + 抽樣）；切換前後各跑一次完整月週期對數；回切演練留紀錄。
**回滾：** 本閘門本身就是在建立回滾能力；未通過則**Phase 5/6/7 不得起手**。
**展開時機：** Phase 2（schema）+ Phase 4（資料存取層）完成後，Phase 5 之前，另寫細計畫。

## Phase 5：批次改直連 RDS + CronJob 化 + 排程重排（需 Phase 2/4 + G1）

**範圍：** 批次資料存取從 Supabase REST 換成 `shared/db.py` 直連 RDS；scan 四支納入 dispatcher；交平台把 8 支排成 k8s CronJob（`args` 傳工作名）；排程重排（Cathy 2026-09-08 定案）：
  - `scan-f1b` 班表播報：**移上班時段（如 08:30）**（✅ 已接受）。
  - `dispatch-notifications`：**收件人跨時區、否決「限上班時段」→ 改「依收件人時區計算發送時間」**（維持全天覆蓋），並與平台談夜間/假日 pod 縮容下的 CronJob 調度支援。
**完成條件：** 批次在容器內直連 RDS 跑通、idempotent；CronJob 定義交付平台；`scan-f1b` 移上班時段、`dispatch` 寬工作窗（見決策檔通知機制真相）；**寫入正本與 G1 定義一致（無批次/前端分裂窗口）**。
**驗證：** 每支 job 手動觸發 + 重複觸發安全（台帳擋重複）；失敗非零退出 + Slack 通知（dry-run 驗一次）。
**回滾：** GH Actions workflow 保留為備援直到 CronJob 穩定；**回切依 G1 的追平/回切機制**（非僅「停 CronJob」——若期間已寫 RDS，需把新寫入補回 Supabase）。
**展開時機：** Phase 2、Phase 4、G1 完成後。

## Phase 6：前端切後端 API + 去 Supabase + Realtime→輪詢 + Edge Function（需 Phase 3/4）

**範圍：** `src/lib/supabase.js` → `apiClient.js`；10 個 `*Api.js` 改打後端；移除 `@supabase/supabase-js`；登入改走後端 OAuth；Realtime → 輪詢 `/api/.../updates?since=`；`trigger-task-engine`（唯一 Edge Function） → 後端起 Job；`approve_staff_request`（**DB RPC、非 Edge Function，在 `01_schema.sql`**） → **後端通用核准 API endpoint**（如 `POST /api/requests/{id}/approve`，Cathy 2026-09-08 確認非 Slack 按鈕；邏輯照 `01_schema.sql` 的 RPC 定義實作，不需另等 Edge Function 出土）。
**完成條件：** 前端 bundle 無任何 Supabase client；所有頁面功能等價；登入走自管 JWT。
**驗證：** 逐頁 e2e（登入、看班表、偏好、交換、通知、核准）；`grep supabase src/` 無殘留。
**回滾：** 前端可用建置旗標在「打 Supabase」與「打後端」間切；回滾＝切回舊 build 部署到 Netlify。**注意：前端寫入切換必須與 G1 的寫入正本切換同步**，否則前端寫 RDS、批次仍 Supabase（或反之）會分裂。
**展開時機：** Phase 3/4 對應塊完成後（需 G1）。

## Phase 7：Cutover + 停用舊平台（需 G1 回切演練通過）

**切換方案（2026-09-08 與 Cathy 議定）：台北凌晨切換 + 短維護窗 + 最後同步，不做雙寫。**

切換前提：Phase 1–6 全綠、G1 回切演練通過；切換前新系統只讀不收使用者寫（單一寫入源仍是 Supabase），UAT 已由 Cathy 驗收通過。

切換 runbook（凌晨、低總量時段執行）：

```
T0-  切換前先「靜止」舊系統的寫入源（否則凍結期仍有寫入，破壞單寫紀律）：
       ① 暫停舊 GitHub Actions 排程（dispatch 每 5 分、scan 等，避免凍結期還在寫/送 Slack）
       ② 等待執行中的 job 收斂（in-flight 工作跑完或安全中止）
       ③ 前端貼「維護中」，停止使用者寫入
T0   台北凌晨（如 00:00）  舊系統進入唯讀（凍結 ~15 分）
T0+  最後同步一次 Supabase→RDS（務必含已核准請假 / 已公佈班表等關鍵資料）
     → 對帳（關鍵表 row-count + 抽樣）
T0+15 切 DNS 指向 EKS 前端 → 新系統開始收寫（RDS 成為寫入正本）；新 CronJob 接手排程
     → 舊系統（Netlify/Supabase）保留為唯讀熱備，供回滾
觀察期後  舊 GH Actions 排程確認不再需要後移除；Supabase/Netlify 退役分「停寫→保留讀→刪除」三段
```

> 🔴 **凍結期單寫紀律**：`T0-` 必須先停舊 GH Actions 觸發並排空 in-flight，才 `T0` 凍結+最後同步。若凍結期舊 dispatch 還在跑，會在「最後同步後」又寫/送，造成資料分岔與重複通知。

> ⏳ 待業務補確認（Cathy 議程 Q9）：**可接受的凍結時長**（~15 分是否足夠 vs 想更短/更長）、**絕對不能停的時間點**（如每月 25 號引擎跑、月底公佈班表）→ 切換日必須避開這些。
> ⚠️ **時區提醒**：員工跨時區（Cathy 議程 Q4/Q6），台北凌晨是**總量最低**而非「全球無人」→ 因此採「短凍結 + 最後同步」而非「賭沒人寫」。

**完成條件：** 全流量走 EKS；舊平台無流量；資料以 RDS 為準；切換後關鍵資料零遺失；**G1 回切演練已成功跑過**。
**驗證：** 切換後一個完整月排班週期（偏好→引擎→發佈→通知→掃描）在新環境跑完無異常；切換前後關鍵表對數一致。
**回滾：** 舊系統為唯讀熱備；DNS 可切回；**回切用 G1 演練過的機制把 RDS 期間新寫入補回 Supabase**；退役分「停寫→保留讀→刪除」三段，每段有觀察期。
**展開時機：** Phase 1–6 全綠 + G1 通過 + 業務確認（Q9 凍結時長/禁切時段）後。

---

## Self-Review

**Spec coverage（對 design doc）：**
> ⚠️ **此 Self-Review 是舊「選項 A 前後端分離」版的自審，2026-09-08 已重新定調（見頂部 banner）。近期只做 Phase 1；下列覆蓋率是對舊 design 的對照，供背景參考。**
- §0 決策（舊 11 項）→ 分散於各 Phase（近期只執行 Phase 1 相關；其餘延後）
- §1 拓撲 / §2 資料層 → P2/P4 ✓
- §3 認證/前端/Realtime/Edge → P3/P6 ✓
- §4 批次/部署/排程 → P1/P5 ✓
- §5 錯誤/測試/第一關 → P1（第一關全展開）✓
- §6 待盤點 → G0 閘門 ✓
- §7 業務確認 → Cathy 2026-09-08 拍板：Realtime→輪詢、播報移上班時段、通用核准、**通知＝寬工作窗**（讀 code 修正）等皆已定；仍 open 僅 Q7 時區分布、Q9 凍結時長/禁切時段、approve 原始碼（併 G0）✓

**Placeholder scan：** Phase 1 所有 code step 為完整可執行內容、無 TBD。Phase 2–7（**全部延後**）為 roadmap 級，日後各自展開細計畫 —— roadmap 級是因 Supabase 黑盒無法寫真 code、且範圍已收斂到 Phase 1，非偷懶。

**Type consistency：** dispatcher `JOBS` key（`schedule-engine` 等）在 Task 2/5/7 一致；`NOTIFY_DRY_RUN` / `APP_BASE_URL` / `require_env()` 在 Task 3 定義並於測試引用一致；`constraints.txt` 在 Task 1 產出、Task 5 Dockerfile 使用；`.venv/bin/pytest` 在 Task 1 建立、後續 Task 沿用。

**Peer-review（codex + 自審，2026-09-08）修正紀錄：** 5 HIGH 全數處理——HIGH-1 `.dockerignore` 移除 `src`（Task 5）；HIGH-2 dry-run 回 tuple 不污染台帳（Task 3）；HIGH-3 URL 改 `{base_url}` 注入 + `main()` fail-fast（Task 3；新 repo 模型下由 compose/CronJob env 提供 `APP_BASE_URL`，**不改任何現行 workflow**）；HIGH-4 nginx 改 unprivileged 非 root/唯讀（Task 6）；HIGH-5 新增 G1 資料遷移/回切閘門。5 MED 全數處理——MED-6 `.env.example` 去 orphan + guard 測試 rglob/regex（Task 4）；MED-7 lockfile/constraints/測試環境（Task 1）；MED-8 測試 mock Slack（Task 3）；MED-9 Phase 1 驗收分「可 build/可用」+ 唯讀驗證；MED-10 `sslmode=no-verify` 源 spec 衝突 → psycopg 用 `require`（Global Constraints）。

---

## Execution Handoff

**照頂部 5 步流程走**：① G0 dump（Cathy，最急）→ ② 照規範重構（去 Supabase，RD；細計畫待 G0 出料）→ ③ 本機 compose 能動 → ④ 灌 sample data → ⑤ UAT（本機、安全）。下方舊 Phase 1–7（容器化現有版 / 選項 A / FastAPI / RDS）已被取代；其工程片段（批次 dispatcher、`.env` 守門、dry-run、Dockerfile、非 root/唯讀）在 ② 重構時可複用。
