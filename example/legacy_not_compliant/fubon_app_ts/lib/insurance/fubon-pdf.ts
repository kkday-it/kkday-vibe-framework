// 產生「富邦上傳用名冊」的 HTML（再由 headless 瀏覽器印成 PDF）。
// 版面對齊 Ina 的官方 PDF：英文姓名、3 欄（姓名/身分證號/生日 YYYY/MM/DD）、
// 依姓名字母排序、含小計人數表頭。

import type { Bucket, ClassifiedTraveler } from "./classify.ts";

/** 名冊用姓名：英文優先（護照姓名），無英文才用中文。 */
function displayName(t: ClassifiedTraveler): string {
  const en = [t.enLastName, t.enFirstName].filter(Boolean).join(" ").trim();
  if (en) return en;
  return [t.localLastName, t.localFirstName].filter(Boolean).join("").trim();
}

/** YYYY-MM-DD / YYYY/M/D → YYYY/MM/DD。 */
function slashDate(s: string): string {
  const m = (s ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return s ?? "";
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

function esc(s: string): string {
  return (s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

/**
 * 產生單一桶的名冊 HTML。
 * @param grandTotal 整份名單總人數（表頭「小計人數」顯示，對齊官方 PDF）。
 */
export function bucketToHtml(bucket: Bucket, grandTotal: number): string {
  const rows = bucket.travelers
    .map((t) => ({ name: displayName(t), id: (t.twIdNo || t.passportNo || "").trim().toUpperCase(), bd: slashDate(t.birthday) }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const body = rows
    .map(
      (r, i) =>
        `<tr><td class="n">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.id)}</td><td>${esc(r.bd)}</td></tr>`
    )
    .join("\n");

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "PingFang TC","Heiti TC","Microsoft JhengHei",sans-serif; color:#000; }
  .meta { margin-bottom:8px; font-size:12px; }
  .meta b { font-size:14px; }
  table { border-collapse: collapse; width:100%; font-size:12.5px; }
  th,td { border:1px solid #999; padding:5px 8px; text-align:left; }
  th { background:#dbe5f1; font-weight:700; }
  td.n, th.n { width:38px; text-align:center; color:#333; }
  caption { text-align:left; font-size:13px; font-weight:700; margin-bottom:6px; }
</style></head><body>
  <div class="meta">小計人數 <b>${grandTotal}</b>　｜　本組（${bucket.tourDays}日 / ${bucket.coverageWan}萬）<b>${rows.length}</b> 人</div>
  <table>
    <thead><tr><th class="n">#</th><th>姓名</th><th>身分證號</th><th>生日</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
</body></html>`;
}
