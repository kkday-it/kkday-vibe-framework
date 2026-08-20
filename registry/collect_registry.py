#!/usr/bin/env python3
"""登錄冊收集器:讀 registry.yaml 的 repo 清單,抓各自的 PROJECT.yaml,
彙整成 vibe-registry.md(全公司 Enterprise Workflows 版圖)。

GitHub repo 經 `gh api` 抓(需 gh auth);local: 路徑直接讀 — 主動申請制 MVP。
用法:python3 collect_registry.py [--out vibe-registry.md]
"""
import argparse
import base64
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent


def fetch_project_yaml(entry: str):
    if entry.startswith("local:"):
        p = Path(entry[6:]) / "PROJECT.yaml"
        if not p.exists():
            return None, "PROJECT.yaml 不存在"
        return yaml.safe_load(p.read_text()), None
    try:
        raw = subprocess.run(
            ["gh", "api", f"repos/{entry}/contents/PROJECT.yaml", "--jq", ".content"],
            capture_output=True, text=True, timeout=30)
        if raw.returncode != 0:
            return None, raw.stderr.strip()[:80] or "gh api 失敗"
        return yaml.safe_load(base64.b64decode(raw.stdout)), None
    except Exception as e:
        return None, str(e)[:80]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "vibe-registry.md"))
    args = ap.parse_args()

    entries = (yaml.safe_load((HERE / "registry.yaml").read_text()) or {}).get("repos", [])
    rows, problems = [], []
    for e in entries:
        data, err = fetch_project_yaml(e)
        if err:
            problems.append(f"| `{e}` | {err} |")
            continue
        t = data.get("touches") or {}
        sched = data.get("schedules") or {}
        rows.append("| {id} | {team} | {owner} | {risk} | {apis} | {ext} | {integ} | {db} | {pii} | {sched} |".format(
            id=data.get("id", "?"), team=data.get("team", "?"), owner=data.get("owner", "?"),
            risk=data.get("risk_tier", "?"),
            apis=", ".join(t.get("internal_apis") or []) or "-",
            ext=", ".join(t.get("external_sites") or []) or "-",
            integ=", ".join(t.get("integrations") or []) or "-",
            db=", ".join(t.get("databases") or []) or "-",
            pii="⚠️" if t.get("pii") else "-",
            sched=", ".join(f"{k}:`{v}`" for k, v in sched.items()) or "-"))

    md = [f"# Vibe 登錄冊(Enterprise Workflows 版圖)— {date.today()}",
          "", f"登記專案:{len(rows)};無法讀取:{len(problems)}(主動申請制,登記見 registry.yaml)", "",
          "| 專案 | team | owner | 風險 | 內部 API | 外站 | 串接 | DB | PII | 排程 |",
          "|---|---|---|---|---|---|---|---|---|---|", *rows]
    if problems:
        md += ["", "## 讀取失敗", "", "| repo | 原因 |", "|---|---|", *problems]
    Path(args.out).write_text("\n".join(md) + "\n")
    print(f"寫出 {args.out}:{len(rows)} 專案,{len(problems)} 失敗")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
