#!/usr/bin/env python3
"""守門檢查(guard.yml 呼叫):PROJECT.yaml schema、workflows manifest、禁用套件。
gitleaks 由 workflow 另跑。exit 0=過,1=紅燈。"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
errors: list[str] = []
warnings: list[str] = []


def check_project_yaml() -> dict:
    p = ROOT / "PROJECT.yaml"
    if not p.exists():
        errors.append("PROJECT.yaml 不存在 — 專案身分證是最低要求")
        return {}
    data = yaml.safe_load(p.read_text()) or {}

    for field in ("id", "owner", "team", "status", "risk_tier", "touches", "schedules"):
        if field not in data:
            errors.append(f"PROJECT.yaml 缺欄位: {field}")
    if data.get("risk_tier") not in ("green", "yellow", "red"):
        errors.append("risk_tier 必須是 green|yellow|red")
    if data.get("status") not in ("active", "archived"):
        errors.append("status 必須是 active|archived")
    if not re.fullmatch(r"[a-z0-9-]+\.[a-z0-9-]+", str(data.get("id", ""))):
        errors.append("id 格式必須是 <team>.<project>(小寫英數與連字號)")

    touches = data.get("touches") or {}
    if touches.get("pii") and data.get("risk_tier") == "green":
        errors.append("pii: true 強制 yellow 以上,不得為 green")

    schedules = data.get("schedules")
    if schedules is not None and not isinstance(schedules, dict):
        errors.append("schedules 必須是 task→cron 的 map(無排程用 {})")
    return data


def check_workflows():
    workflows_dir = ROOT / "workflows"
    if not workflows_dir.is_dir():
        return []
    for workflow in sorted(d for d in workflows_dir.iterdir() if d.is_dir()):
        manifest = workflow / "manifest.yaml"
        if not manifest.exists():
            errors.append(f"workflows/{workflow.name}: 缺 manifest.yaml")
            continue
        try:
            data = yaml.safe_load(manifest.read_text()) or {}
            
            # Schema Validation (Basic)
            if data.get("version") != "1.0":
                errors.append(f"workflows/{workflow.name}: 必須有 version: '1.0'")
                
            wf_data = data.get("workflow", {})
            for field in ["id", "description", "risk_tier"]:
                if field not in wf_data:
                    errors.append(f"workflows/{workflow.name}: workflow 區塊缺欄位 {field}")
                    
            permissions = data.get("permissions", {})
            creds = permissions.get("credentials", [])
            for ref in creds:
                if not ref.startswith("vault://"):
                    errors.append(f"workflows/{workflow.name}: credentials 只准 vault:// 引用,不准出現值({ref[:20]}…)")
                    
        except Exception as e:
            errors.append(f"workflows/{workflow.name}: manifest 解析失敗 ({e})")
        if not (workflow / "tests").is_dir():
            errors.append(f"workflows/{workflow.name}: 缺 tests/(至少一組 dry-run 用例)")


FORBIDDEN_DEPS = ("slack_sdk", "slack-sdk", "google-api-python-client", "@slack/web-api", "googleapis")


def check_forbidden_deps(risk_tier: str):
    hits = []
    for name in ("requirements.txt", "package.json", "package-lock.json", "poetry.lock", "uv.lock"):
        f = ROOT / name
        if not f.exists():
            continue
        text = f.read_text(errors="ignore")
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("#"):
                continue
            for dep in FORBIDDEN_DEPS:
                if dep in s:
                    hits.append(f"{name}: {s[:60]}")
    if hits:
        msg = "直連 SDK 禁用(串接一律經 kkday-connectors): " + "; ".join(hits)
        if risk_tier in ("yellow", "red"):
            errors.append(msg)
        else:
            warnings.append(msg)


def check_cloud_ready_spec(data: dict):
    # 1. 必備檔案缺失
    if not (ROOT / "Dockerfile").exists():
        errors.append("Cloud-Ready: 根目錄缺少 Dockerfile")
    if not (ROOT / ".dockerignore").exists():
        errors.append("Cloud-Ready: 根目錄缺少 .dockerignore")
        
    # 2. 環境變數分類
    env_example = ROOT / ".env.example"
    if env_example.exists():
        content = env_example.read_text()
        if "[Runtime Secret]" not in content or "[Runtime Plain]" not in content:
            warnings.append("Cloud-Ready: .env.example 未包含 [Runtime Secret] 與 [Runtime Plain] 的分類標籤")
            
    # 3. 排程 API 檢查
    schedules = data.get("schedules")
    if schedules:
        api_py = ROOT / "src" / "api.py"
        if api_py.exists():
            api_content = api_py.read_text()
            if "/api/jobs/" not in api_content and "cron" not in api_content:
                errors.append("Cloud-Ready: 宣告了 schedule，但 src/api.py 中沒有 /api/jobs/ 相關的 Endpoint 實作")
        else:
            errors.append("Cloud-Ready: 宣告了 schedule，但找不到 src/api.py 或對應的 Cron Endpoint")

    # 4. 反模式掃描
    anti_patterns = {
        "localhost": "禁用 localhost，應走內部 DNS 或跨容器服務名",
        "127.0.0.1": "禁用 127.0.0.1，應走內部 DNS",
        "sqlite": "禁用 SQLite，Cloud-Ready 請走 PostgreSQL",
        "./uploads": "禁用本地寫入 ./uploads，請使用 ctx.storage / S3",
        "create table": "禁止 runtime DDL，請走 db/migrations"
    }
    for file_path in ROOT.rglob("*.py"):
        rel = str(file_path.relative_to(ROOT))
        if any(skip in rel for skip in ("venv", ".venv", "scripts/", "tests/")):
            continue
        try:
            lines = file_path.read_text().splitlines()
            for line in lines:
                if line.strip().startswith("#"):
                    continue
                content = line.lower()
                for pattern, msg in anti_patterns.items():
                    if pattern in content:
                        errors.append(f"Cloud-Ready 反模式 ({file_path.name}): {msg}")
        except Exception:
            pass
            
    # 5. Dockerfile 安全規範
    dockerfile = ROOT / "Dockerfile"
    if dockerfile.exists():
        df_content = dockerfile.read_text()
        if "USER root" in df_content or re.search(r'^USER\s+0', df_content, re.M):
            errors.append("Cloud-Ready Dockerfile: 禁止使用 root 權限 (USER root)")
        if "COPY .env " in df_content or "COPY .env.production" in df_content:
            errors.append("Cloud-Ready Dockerfile: 禁止複製 .env 進入 image，secret 必須由 runtime 注入")


def main() -> int:
    data = check_project_yaml()
    check_workflows()
    check_forbidden_deps(str(data.get("risk_tier", "green")))
    check_cloud_ready_spec(data)

    for w in warnings:
        print(f"::warning::{w}")
    for e in errors:
        print(f"::error::{e}")
    if errors:
        print(f"\nguard: {len(errors)} 個紅燈")
        return 1
    print("guard: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
