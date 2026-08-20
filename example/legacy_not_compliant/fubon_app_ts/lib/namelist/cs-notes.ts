/**
 * 客服追加備註（客人下訂之後才通知的需求）。
 *
 * 來源：大表「JP自社ツアー一覧表」裡的客服備註分頁（gid 2014347691），
 *       欄＝商品編號｜日期｜訂單編號｜需求（備註）｜是否通知BD。
 * ⚠️ 這份資料不在資料倉庫裡，是人工維護的表 → Data Team 出的 CSV 不會有，
 *    必須由我們自己讀這張表、合併進導遊名單。漏掉就等於導遊拿到過期資訊。
 *
 * 兩件事：
 *  1. 追加備註要接在原訂單備註後面一起給導遊。
 *  2. 「同行單」要解析成**群組**——那是分車與座位安排的真正依據
 *     （寫法很雜：「同行單：xxx」「xxx 為同行單」「同行訂單，xxx，yyy」→ 一律用訂單編號正則抓）。
 */

/** 訂單編號長相：25KK251472692（年2碼 + KK + 9碼）。大小寫都收。 */
const MID_RE = /\b(\d{2}KK\d{9})\b/gi;
const normMid = (s: string) => s.trim().toUpperCase();

export type CsNote = {
  productNo: string;
  date: string;
  mid: string;
  note: string;
  /** 這筆備註裡提到的其他訂單編號（同行單）。 */
  companions: string[];
  notifiedBd: string;
  rowNo: number;
};

/** 從分頁的二維陣列解析。第一列是標題；夾在資料中的月份列（如「2024/10」）會被跳過。 */
export function parseCsNotes(rows: string[][]): CsNote[] {
  const out: CsNote[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const [productNo = "", date = "", midRaw = "", note = "", notifiedBd = ""] = r.map((c) => String(c ?? "").trim());
    const mid = normMid(midRaw);
    // 月份分隔列（A 欄是 2024/10 這種、沒有訂單編號）→ 跳過
    if (!/^\d{2}KK\d{9}$/i.test(mid)) continue;
    if (!note) continue;
    const companions = [...new Set((note.match(MID_RE) ?? []).map(normMid))].filter((m) => m !== mid);
    out.push({ productNo, date, mid, note, companions, notifiedBd, rowNo: i + 1 });
  }
  return out;
}

/** 同一個訂單可能有多筆追加備註 → 合併成一條（保留順序、去重）。 */
export function notesByMid(notes: CsNote[]): Map<string, { text: string; companions: string[]; count: number }> {
  const m = new Map<string, { text: string; companions: string[]; count: number }>();
  for (const n of notes) {
    const cur = m.get(n.mid) ?? { text: "", companions: [] as string[], count: 0 };
    const parts = cur.text ? cur.text.split(" ／ ") : [];
    if (!parts.includes(n.note)) parts.push(n.note);
    m.set(n.mid, {
      text: parts.join(" ／ "),
      companions: [...new Set([...cur.companions, ...n.companions])],
      count: cur.count + 1,
    });
  }
  return m;
}

/**
 * 把「同行單」關係併成群組（union-find）。
 * 例：A 說跟 B 同行、B 說跟 C 同行 → {A,B,C} 同一群，導遊要安排坐一起／同一車。
 * 回傳 mid → 群組代號（群組內最小的訂單編號，穩定好認）。
 */
export function companionGroups(notes: CsNote[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let p = parent.get(x)!;
    if (p !== x) { p = find(p); parent.set(x, p); }
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);   // 小的當代表
  };
  for (const n of notes) for (const c of n.companions) union(n.mid, c);

  const groups = new Map<string, string>();
  for (const k of parent.keys()) {
    const root = find(k);
    // 只保留真的有同行關係的（自己一群就不算）
    if ([...parent.keys()].some((o) => o !== k && find(o) === root)) groups.set(k, root);
  }
  return groups;
}
