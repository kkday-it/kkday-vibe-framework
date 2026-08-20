/**
 * 大表「每日總表確認」分頁（gid 573431349）＝ OP 每天自己確認的出團清單。
 *
 * 版面是四個區塊並排：明天出團(名單) / 四天成團 / 七天成團 / 14天成團(多日遊)，
 * 每塊上方寫日期（08/07），下方是 OID｜團名｜人數｜是否成團。
 *
 * 為什麼要讀它：這是**人自己確認過**的清單，拿來跟我從各商品分頁掃出來的團互相對照——
 * 我多抓的可能是已關團的殘列，我少抓的就是漏團。而且它有「是否成團」，
 * **不催行的團不該寄名單**（各商品分頁的團號列不一定會刪掉）。
 */
export type DailyTour = {
  /** 可能帶車別碼，例 528834C */
  code: string;
  productNo: string;
  carLetter: string;
  name: string;
  pax: number | null;
  /** 催行決定 / 不催行 / 催行待ち */
  status: string;
  region: string;
  /** true＝確定出團 */
  go: boolean;
};

export type DailyBlock = { title: string; date: string; tours: DailyTour[] };

const GO_RE = /催行決定|決定|出團/;
const NOGO_RE = /不催行|中止|取消|關團/;

/** 把「08/07」補成完整日期（跨年時取最近的一年）。 */
export function toIso(md: string, today = new Date()): string {
  const m = /^(\d{1,2})\s*[\/\-月]\s*(\d{1,2})/.exec(String(md ?? "").trim());
  if (!m) return "";
  const mm = Number(m[1]), dd = Number(m[2]);
  let y = today.getFullYear();
  // 12 月看到 1 月＝明年
  if (today.getMonth() === 11 && mm === 1) y++;
  else if (today.getMonth() === 0 && mm === 12) y--;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** 從整個分頁的二維陣列解析出四個區塊。 */
export function parseDailyConfirm(rows: string[][], today = new Date()): DailyBlock[] {
  const cell = (r: number, c: number) => String(rows[r]?.[c] ?? "").trim();
  // 標題列：找含「OID」或「編號」的那一列，每個出現位置就是一個區塊的起點
  let hdrRow = -1;
  for (let r = 0; r < Math.min(12, rows.length); r++) {
    if ((rows[r] ?? []).some((c) => /^(OID|編號)$/.test(String(c ?? "").trim()))) { hdrRow = r; break; }
  }
  if (hdrRow < 0) return [];
  const starts: number[] = [];
  (rows[hdrRow] ?? []).forEach((c, i) => { if (/^(OID|編號)$/.test(String(c ?? "").trim())) starts.push(i); });

  const blocks: DailyBlock[] = [];
  for (const c0 of starts) {
    // 區塊標題與日期在標題列上方（往上找最近的非空）
    let title = "", date = "";
    for (let r = hdrRow - 1; r >= 0 && (!title || !date); r--) {
      const v = cell(r, c0) || cell(r, c0 + 1) || cell(r, c0 + 2);
      if (!v) continue;
      if (!date && /^\d{1,2}\s*[\/\-月]\s*\d{1,2}/.test(v)) date = toIso(v, today);
      else if (!title) title = v;
    }
    const tours: DailyTour[] = [];
    for (let r = hdrRow + 1; r < rows.length; r++) {
      const raw = cell(r, c0);
      if (!raw) continue;
      const m = /^(\d{3,8})\s*([A-Za-z])?/.exec(raw);
      if (!m) continue;
      const status = cell(r, c0 + 3);
      const paxRaw = cell(r, c0 + 2);
      tours.push({
        code: raw, productNo: m[1], carLetter: m[2] ?? "",
        name: cell(r, c0 + 1), pax: /^\d+$/.test(paxRaw) ? Number(paxRaw) : null,
        status, region: cell(r, c0 + 4),
        go: GO_RE.test(status) && !NOGO_RE.test(status),
      });
    }
    blocks.push({ title, date, tours });
  }
  return blocks;
}

/** 取「明天出團(名單)」那一塊——那才是要寄名單的。 */
export function namelistBlock(blocks: DailyBlock[]): DailyBlock | undefined {
  return blocks.find((b) => /名單/.test(b.title)) ?? blocks[0];
}
