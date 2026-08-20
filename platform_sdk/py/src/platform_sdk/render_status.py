"""狀態頁 renderer(§6/§12-2):吃 runs/ 的 JSONL+summary 吐 self-contained HTML。

- render_run(run_id):單一 run 的狀態頁(<run_id>.html)— 步驟時間軸+log 明細
- render_index():專案 index.html — 從 runs/ 全量重建(DB 就緒後改讀 DB)
執行中的 run 頁帶 <meta refresh>,配合狀態頁同名覆蓋(cloud-ready 落點為 S3 / status endpoint)= 輪詢式準實時。
PII 紅線:遮罩交給呼叫端 log 時不寫明細;本 renderer 不外掛資料。
用法:python -m platform_sdk.render_status [--run-id r-x] [--runs-dir runs]
"""
import argparse
import html
import json
from pathlib import Path

_CSS = """body{font-family:ui-sans-serif,system-ui,'PingFang TC',sans-serif;margin:2rem auto;max-width:960px;
padding:0 1rem;color:#1a202c}h1{font-size:1.3rem}.ok{color:#0a7d33}.err{color:#c0392b}
table{border-collapse:collapse;width:100%;font-size:.85rem}td,th{border:1px solid #e2e8f0;padding:.35rem .5rem;
text-align:left;vertical-align:top}th{background:#f7fafc}code{background:#f1f5f9;padding:0 .25rem;border-radius:3px}
.badge{display:inline-block;padding:.1rem .5rem;border-radius:99px;font-size:.75rem;color:#fff}
.b-success{background:#0a7d33}.b-error{background:#c0392b}.b-running{background:#b7791f}
.data{color:#64748b;white-space:pre-wrap;word-break:break-all}"""


def _read_jsonl(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def _badge(status):
    cls = {"success": "b-success", "error": "b-error"}.get(status, "b-running")
    return f'<span class="badge {cls}">{html.escape(str(status))}</span>'


def render_run(run_id, runs_dir="runs"):
    d = Path(runs_dir)
    summary_p = d / f"{run_id}.summary.json"
    summary = json.loads(summary_p.read_text()) if summary_p.exists() else {"status": "running"}
    logs = _read_jsonl(d / f"{run_id}.jsonl")
    running = not summary_p.exists()
    refresh = '<meta http-equiv="refresh" content="60">' if running else ""

    rows = "".join(
        f"<tr><td>{html.escape(r.get('ts',''))}</td><td>{html.escape(str(r.get('step') or '-'))}</td>"
        f"<td class={'err' if r.get('level')=='ERROR' else 'ok'}>{html.escape(r.get('level',''))}</td>"
        f"<td>{html.escape(str(r.get('msg','')))}"
        + (f"<div class=data>{html.escape(json.dumps(r['data'], ensure_ascii=False))}</div>" if r.get("data") else "")
        + "</td></tr>" for r in logs)

    fail_hint = ""
    if summary.get("status") == "error":
        fail_hint = (f"<p class=err><b>失敗:</b> {html.escape(str(summary.get('error_msg','')))}"
                     f"<br>重跑指引:確認冪等後由 team 成員經告警內 magic link 重跑(建新 run,引用本 run)。</p>")

    body = f"""<title>{html.escape(summary.get('workflow','run'))} · {run_id}</title>{refresh}
<style>{_CSS}</style>
<h1>{html.escape(summary.get('workflow','?'))} — {run_id} {_badge(summary.get('status'))}</h1>
<p>耗時 {summary.get('duration_s','…')}s · <a href="index.html">← 專案 runs 一覽</a></p>{fail_hint}
<table><tr><th>時間</th><th>步驟</th><th>level</th><th>訊息</th></tr>{rows}</table>"""
    out = d / f"{run_id}.html"
    out.write_text(body)
    return out


def render_index(runs_dir="runs", project_id=""):
    d = Path(runs_dir)
    summaries = []
    for p in sorted(d.glob("*.summary.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            summaries.append(json.loads(p.read_text()))
        except Exception:
            continue
    rows = "".join(
        f"<tr><td><a href='{s['run_id']}.html'>{s['run_id']}</a></td>"
        f"<td>{html.escape(s.get('workflow','?'))}</td><td>{_badge(s.get('status'))}</td>"
        f"<td>{s.get('duration_s','-')}s</td></tr>" for s in summaries)
    body = f"""<title>{html.escape(project_id or 'runs')} · index</title>
<meta http-equiv="refresh" content="60"><style>{_CSS}</style>
<h1>{html.escape(project_id or '')} runs(最新在前,全量重建自 run 記錄)</h1>
<table><tr><th>run</th><th>workflow</th><th>狀態</th><th>耗時</th></tr>{rows}</table>"""
    out = d / "index.html"
    out.write_text(body)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id")
    ap.add_argument("--runs-dir", default="runs")
    ap.add_argument("--project-id", default="")
    args = ap.parse_args()
    if args.run_id:
        print(render_run(args.run_id, args.runs_dir))
    print(render_index(args.runs_dir, args.project_id))


if __name__ == "__main__":
    main()
