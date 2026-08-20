"""platform_sdk local shim — workflow 與外界互動的唯一合法管道(ctx.*)。

原則:contract 介面凍結、實作可換。平台上線後 flow 程式碼零修改。
決策依據:project-template-v0.md §4.5 / §12。
"""
import json
import logging
import os
import sys
import time
import uuid
import warnings
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from .errors import CheckpointNotApproved, CheckpointRejected, NotYetImplemented

load_dotenv()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SecretManager:
    """取憑證。只認 vault:// 引用;MVP 以 env 代 vault,介面不變。

    vault://<project>/<KEY> → 過渡期解析為 env 變數 <KEY>。
    值絕不寫入 log。
    """

    def get(self, ref, default=None):
        key = ref.split("/")[-1] if str(ref).startswith("vault://") else str(ref)
        if not str(ref).startswith("vault://"):
            warnings.warn(f"[secrets] 建議用 vault:// 引用(收到: {ref})", stacklevel=2)
        val = os.environ.get(key, default)
        if val is None:
            logging.warning(f"[secrets] 無法取得機密: {ref}(env {key} 未設定)")
        return val


class LogManager:
    """結構化 JSONL log(§12-2):每行 ts/run_id/workflow/step/level/msg/data。

    執行中寫本機 runs/<run_id>.jsonl(結束由框架上傳 S3 — MVP 先留本機);
    同時鏡射到 stdout 供 Dkron 執行紀錄。
    """

    def __init__(self, workflow_id, run_id, log_dir="runs"):
        self._workflow = workflow_id
        self._run_id = run_id
        self._step = None
        self._dir = Path(log_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self.path = self._dir / f"{run_id}.jsonl"
        self._stdout = logging.getLogger(f"workflow.{workflow_id}")
        self._stdout.propagate = False  # 不往 root 冒泡,避免重複輸出
        if not self._stdout.handlers:
            h = logging.StreamHandler()
            h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] [%(name)s] %(message)s"))
            self._stdout.addHandler(h)
        self._stdout.setLevel(logging.INFO)

    def _emit(self, level, msg, **data):
        rec = {"ts": _now(), "run_id": self._run_id, "workflow": self._workflow,
               "step": self._step, "level": level, "msg": str(msg)}
        if data:
            rec["data"] = data
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        getattr(self._stdout, level.lower(), self._stdout.info)(f"[{self._step or '-'}] {msg}")

    def info(self, msg, **data):
        self._emit("INFO", msg, **data)

    def warning(self, msg, **data):
        self._emit("WARNING", msg, **data)

    def error(self, msg, **data):
        self._emit("ERROR", msg, **data)

    @contextmanager
    def step(self, name):
        prev, self._step = self._step, name
        self._emit("INFO", "step start")
        t0 = time.time()
        try:
            yield
            self._emit("INFO", "step done", duration_s=round(time.time() - t0, 2))
        except Exception as e:
            self._emit("ERROR", f"step failed: {e}", duration_s=round(time.time() - t0, 2))
            raise
        finally:
            self._step = prev


class NotificationManager:
    """ctx.notify(msg) — Slack 通知(team channel)。MVP 印 log,介面即最終形。"""

    def __init__(self, log: LogManager):
        self._log = log

    def __call__(self, message):
        # MVP:印出;kkday-connectors 就緒後改打統一 bot
        self._log.info(f"🔔 [SLACK NOTIFY] {message}")

    def slack(self, message):  # 舊介面相容
        self(message)


class BrowserManager:
    """受管 headless 瀏覽器 — 引擎收斂 Playwright(§12-6)。

    - new_page():Playwright chromium headless,回傳 page(主介面)
    - get_driver():Selenium 降級相容(DeprecationWarning;example 改寫完即移除)
    """

    def __init__(self, log: LogManager):
        self._log = log
        self._pw = None
        self._browser = None
        self._drivers = []
        self.last_page = None

    def new_page(self, storage_state=None, no_viewport=False, **launch_kwargs):
        """開一個受管 Playwright 分頁。storage_state 可帶既有登入 session(如 odoo_session.json)。"""
        from playwright.sync_api import sync_playwright
        if self._browser is None:
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=True, **launch_kwargs)
        context_kwargs = {}
        if storage_state:
            context_kwargs["storage_state"] = storage_state
        if no_viewport:
            context_kwargs["no_viewport"] = True
        browser_context = self._browser.new_context(**context_kwargs)
        self.last_page = browser_context.new_page()
        return self.last_page

    def get_driver(self, download_dir=None):
        warnings.warn("get_driver()(Selenium)已淘汰,改用 ctx.browser.new_page()(Playwright)",
                      DeprecationWarning, stacklevel=2)
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from webdriver_manager.chrome import ChromeDriverManager

        options = Options()
        options.add_argument("--headless=new")  # server 上必 headless(§12-6)
        options.add_argument("--disable-blink-features=AutomationControlled")
        prefs = {"download.prompt_for_download": False, "plugins.always_open_pdf_externally": True}
        if download_dir:
            prefs["download.default_directory"] = download_dir
        options.add_experimental_option("prefs", prefs)
        driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
        self._drivers.append(driver)
        return driver

    def capture_failure(self, out_dir: Path):
        """失敗三件套①:截圖+最後 HTML(best effort,框架在 flow 拋錯時呼叫)。"""
        saved = []
        out_dir.mkdir(parents=True, exist_ok=True)
        try:
            if self.last_page is not None:
                self.last_page.screenshot(path=str(out_dir / "error.png"))
                (out_dir / "error.html").write_text(self.last_page.content())
                saved += ["error.png", "error.html"]
            for i, d in enumerate(self._drivers):
                d.save_screenshot(str(out_dir / f"error_selenium_{i}.png"))
                (out_dir / f"error_selenium_{i}.html").write_text(d.page_source)
                saved.append(f"error_selenium_{i}.png")
        except Exception as e:
            self._log.warning(f"現場保全失敗(不影響主錯誤): {e}")
        return saved

    def close(self, driver=None):
        try:
            if driver is not None:
                driver.quit()
                return
            for d in self._drivers:
                d.quit()
            if self._browser is not None:
                self._browser.close()
                self._pw.stop()
        except Exception:
            pass


class _NotYet:
    """介面凍結、實作未到位的殼(§12):呼叫即拋 typed error,不要繞去自己 import 套件。"""

    def __init__(self, name, hint):
        self._name, self._hint = name, hint

    def __getattr__(self, attr):
        def _raise(*a, **kw):
            raise NotYetImplemented(f"ctx.{self._name}.{attr}() 尚未實作 — {self._hint}")
        return _raise


class Context:
    """注入給所有 workflow flow 的 Context — 與外界互動的唯一合法管道。

    模式(VIBE_RUN_MODE):interactive(預設,本機) | worker(無人在場,Dkron 派工)。
    """

    def __init__(self, workflow_id, run_id=None, mode=None):
        self.workflow_id = workflow_id
        self.run_id = run_id or f"r-{uuid.uuid4().hex[:8]}"
        self.mode = mode or os.environ.get("VIBE_RUN_MODE", "interactive")

        self.log = LogManager(workflow_id, self.run_id)
        self.logger = self.log._stdout  # 舊介面相容(ctx.logger.info)
        self.secrets = SecretManager()
        self.notify = NotificationManager(self.log)
        self.browser = BrowserManager(self.log)

        # 介面凍結、實作隨 kkday-connectors 補齊(§12)
        self.db = _NotYet("db", "vibe DB(專案 schema)")
        self.storage = _NotYet("storage", "S3 檔案產出")
        self.sheet = _NotYet("sheet", "Google Sheet 匯出視圖(SA+Shared Drive)")
        self.mail = _NotYet("mail", "發信(SA+白名單寄件人)")

    def checkpoint(self, preview):
        """確認點(紅區必用)— 分模式,絕不 stdin 等待(§12-3/§4.5)。

        interactive:印 preview,需 --yes(或 VIBE_YES=1)才續跑。
        worker:多方參數已補齊(VIBE_APPROVED=1,由 worker 依狀態機注入)即通過,否則 fail fast。
        """
        self.log.info("checkpoint", preview=str(preview)[:500])
        if self.mode == "worker":
            if os.environ.get("VIBE_APPROVED") == "1":
                self.log.info("checkpoint auto-passed(參數即審核:狀態機已放行)")
                return True
            raise CheckpointNotApproved("run 未經放行(多方參數未補齊)— fail fast,不等待")
        # interactive
        print(f"\n=== CHECKPOINT PREVIEW ===\n{preview}\n==========================")
        if "--yes" in sys.argv or os.environ.get("VIBE_YES") == "1":
            self.log.info("checkpoint passed(--yes)")
            return True
        raise CheckpointRejected("未帶 --yes,確認點擋下(檢視 preview 後重跑加 --yes)")
