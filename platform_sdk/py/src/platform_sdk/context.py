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
from typing import Optional

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
        if not str(ref).startswith("vault://"):
            warnings.warn(f"[secrets] 必須用 vault:// 引用(收到: {ref})", stacklevel=2)
            
        key = ref.split("/")[-1] if str(ref).startswith("vault://") else str(ref)
        val = os.environ.get(key, default)
        
        if val is None:
            raise ValueError(f"[secrets] 無法取得機密: {ref} (環境變數 {key} 未設定)")
        return val


class LogManager:
    """結構化 JSON log(§2.9):每行 ts/run_id/workflow/step/level/msg/data。

    Cloud-Ready: log 只寫 stdout/stderr（Spec §2.9 硬約束 #10）。
    K8s 的 log collector 會自動收集 stdout。
    """

    def __init__(self, workflow_id, run_id, log_dir="/tmp/vibe_logs"):
        self._workflow = workflow_id
        self._run_id = run_id
        self._step = None
        # path 保留供 runner summary 參照，但 LogManager 本身不寫檔
        self._dir = Path(os.environ.get("VIBE_LOG_PATH", log_dir))
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
        # Spec §2.9: log 只寫 stdout，以 JSON 格式輸出
        print(json.dumps(rec, ensure_ascii=False), flush=True)
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
    """ctx.notify(msg) — Slack 通知(team channel)。如果環境變數有 SLACK_WEBHOOK_URL 則發送。"""

    def __init__(self, log: LogManager):
        self._log = log

    def __call__(self, message):
        import os
        webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
        if webhook_url:
            import requests
            try:
                requests.post(webhook_url, json={"text": message}, timeout=5)
                self._log.info(f"🔔 [SLACK NOTIFY SENT] {message}")
            except Exception as e:
                self._log.error(f"❌ [SLACK NOTIFY FAILED] {e}")
        else:
            self._log.info(f"🔔 [SLACK NOTIFY MOCKED] {message}")

    def slack(self, message):  # 舊介面相容
        self(message)


class StorageManager:
    """ctx.storage — 產出檔案儲存 adapter(Spec §2.4 / §2.8),用 env 切換實作。

    STORAGE_PROVIDER=local(預設,開發用)| s3(雲上)。
    - local:寫 /tmp(暫存;重啟即失、多 pod 不共享)—— **僅供本機開發,不可當持久儲存**。
    - s3:走 AWS SDK 預設憑證鏈(pod 綁 IAM role),程式內零 key;只需 S3_BUCKET(+ 選用 AWS_REGION / S3_PREFIX)。
    """

    def __init__(self, log: LogManager):
        self._log = log
        self.provider = os.environ.get("STORAGE_PROVIDER", "local").lower()
        if self.provider == "s3":
            self.bucket = os.environ.get("S3_BUCKET")
            if not self.bucket:
                raise ValueError("[storage] STORAGE_PROVIDER=s3 需要 S3_BUCKET env(fail fast,Spec §2.2)")
            self.region = os.environ.get("AWS_REGION")
            self.prefix = os.environ.get("S3_PREFIX", "").strip("/")
        else:
            self.base_path = Path(os.environ.get("VIBE_STORAGE_PATH", "/tmp/vibe_storage"))
            self.base_path.mkdir(parents=True, exist_ok=True)

    def _s3(self):
        # 預設憑證鏈(Spec §2.4);不讀 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
        import boto3
        return boto3.client("s3", region_name=self.region) if self.region else boto3.client("s3")

    def _key(self, filename: str) -> str:
        return f"{self.prefix}/{filename}" if self.prefix else filename

    def put(self, filename: str, content, content_type: Optional[str] = None) -> str:
        """上傳產出並回傳可存取位置(s3://... 或本機路徑)。content 可為 str 或 bytes。"""
        data = content.encode("utf-8") if isinstance(content, str) else content
        if self.provider == "s3":
            key = self._key(filename)
            kwargs = {"Bucket": self.bucket, "Key": key, "Body": data}
            if content_type:
                kwargs["ContentType"] = content_type
            self._s3().put_object(**kwargs)
            uri = f"s3://{self.bucket}/{key}"
            self._log.info(f"📝 [STORAGE:s3] 已上傳: {uri}")
            return uri
        path = self.base_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self._log.info(f"📝 [STORAGE:local] 寫入 {path}(暫存,勿當持久儲存;雲上請設 STORAGE_PROVIDER=s3)")
        return str(path)

    def presigned_url(self, filename: str, expires_in: int = 3600) -> str:
        """給瀏覽器直接下載的 presigned URL(僅 s3,Spec §2.4)。"""
        if self.provider != "s3":
            raise NotYetImplemented("presigned_url() 僅在 STORAGE_PROVIDER=s3 可用")
        return self._s3().generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": self._key(filename)},
            ExpiresIn=expires_in,
        )

    def write_text(self, filename: str, content: str) -> str:
        """相容舊介面 → 等同 put(text)。"""
        return self.put(filename, content, content_type="text/plain; charset=utf-8")


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

    模式(VIBE_RUN_MODE):interactive(預設,本機) | worker(無人在場,排程派工)。
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
        self.db = _NotYet("db", "Database(專案 schema)")
        self.storage = StorageManager(self.log)
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
