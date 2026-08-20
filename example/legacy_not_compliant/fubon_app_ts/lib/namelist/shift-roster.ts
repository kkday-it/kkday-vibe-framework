/**
 * 讀「導遊班表」：那一天每個商品排了誰。
 *
 * 為什麼名單流程也要讀班表（Ina 2026-08-13）：
 * 大表的「服務型態」是**推出來的**——導遊欄有字＝純司機、空白＝司兼導。
 * 所以「純司機團但忘了填導遊」在大表上長得跟「司兼導團」一模一樣，光看大表分不出來。
 * 班表是另一個獨立來源：班表排了人、大表卻空白 → 就是漏填，這時要催。
 *
 * 班表格式：一個分頁一個月；日期橫向（3/15）、導遊直向，格子裡是「商品OID＋車別碼」（284399A）。
 * 導遊電話在姓名的**下一列**。
 */
export type RosterGuide = { name: string; phone: string; car: string };

const norm = (v: unknown) => String(v ?? "").replace(/[\s　]/g, "").trim();
const digits = (v: unknown) => String(v ?? "").replace(/[^\d+]/g, "");

/** 從分頁名稱挑出該月份的分頁。找不到回 null——寧可講「沒讀到班表」也不要拿別月的。 */
export function pickMonthTab(titles: string[], date: string): string | null {
  const yy = date.slice(2, 4), mm = date.slice(5, 7);
  return titles.find((t) => t.includes(`${yy} ${mm}月`) || t.includes(`${yy}.${mm}`)) ?? null;
}

/** 解析單一分頁 → 商品 OID → 那天排到的導遊。 */
export function parseRoster(rows: string[][], date: string): Map<string, RosterGuide[]> {
  const m = String(Number(date.slice(5, 7))), d = String(Number(date.slice(8, 10)));
  const roster = new Map<string, RosterGuide[]>();
  let col = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    // 日期列可能出現多次（每隔幾列重下標題）→ 每遇到一次就更新欄位，之後的資料列都用最近一次的
    const at = row.findIndex((c) => new RegExp(`^${m}/${d}$`).test(String(c ?? "").trim()));
    if (at > 0) { col = at; continue; }
    if (col < 0 || !row[0]) continue;
    const mo = /^(\d{4,7})\s*([A-Za-z])?/.exec(String(row[col] ?? "").trim());
    if (!mo) continue;
    const list = roster.get(mo[1]) ?? [];
    list.push({ name: norm(row[0]), phone: digits(rows[i + 1]?.[0] ?? ""), car: mo[2] ?? "" });
    roster.set(mo[1], list);
  }
  return roster;
}
