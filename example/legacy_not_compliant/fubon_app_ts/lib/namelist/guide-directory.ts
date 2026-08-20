/**
 * 讀「導遊＆車公司名單」：一位司導的對客聯絡方式。
 *
 * 2026-08-14 改版（Ina）：**不再上傳 QR 圖給客人**。
 * 名單上維護一條「Line 連結」（LINE 加好友網址），回填 SCM 時身份選 LINE、
 * 帳號直接放那條連結——客人在手機上點一下就加到，不必存圖再開 LINE 掃。
 * 因此這裡回傳的 lineUrl 是**網址**，不是 LINE ID。
 *
 * 兩個分頁欄位不同，但要的東西一樣：
 *   專屬團導遊名單　 Guide Name／手機／Line 連結／WhatsApp 帳號／WeChat 帳號
 *   專屬團司兼導名單 導遊姓名／電話／Line 連結／WhatsApp 帳號／WeChat 帳號
 */
import { toTraditional } from "./guide-namelist.ts";

export const GUIDE_SHEET_ID = "1FucKJ-bS9xRbxv4GcspeB_RcoMaV1P6xjDDyZQUmZNY";

export type Contact = { type: string; account: string };
export type DirectoryEntry = {
  name: string;
  phone: string;
  /** LINE 加好友網址（不是 ID）。空字串＝名單還沒填。 */
  lineUrl: string;
  /** 導遊信箱；司兼導名單那張沒有這欄，會是空字串 */
  email: string;
  /** WhatsApp／WeChat 等其他軟體，一起送進 SCM 的 ims */
  contacts: Contact[];
};

const txt = (v: unknown) => String(v ?? "").trim();
/** 比對用：去空白（含全形）、轉小寫。名單上的姓名寫法差在空白很常見。 */
/**
 * 姓名比對用的鍵。除了去空白與大小寫，還**統一轉成繁體**。
 *
 * 為什麼：大表與導遊名單是兩個人在維護的兩張表，同一位導遊寫成「田陽」或「田阳」
 * 都可能發生。名字對不上的後果不是報錯，而是**查不到那位導遊的信箱、名單就寄不出去**，
 * 而那看起來只像「這位導遊沒登記」（Ina 2026-08-18 剛把大表那邊從簡體改成繁體，
 * 這次兩邊剛好都對；下次不一定）。
 */
export const nameKey = (v: unknown) => toTraditional(txt(v)).replace(/[\s　]/g, "").toLowerCase();

/**
 * 一格姓名可能同時寫了好幾種寫法（2026-08-15 實測導遊名單）：
 *   「毛曉彩／毛暁彩」          ← 繁體與日本漢字並列
 *   「森山明明（モリヤマミンミン）」← 括號裡是片假名讀音
 * 大表寫的是「毛曉彩」「森山明明」，跟整格都不相等 → 原本查不到人、名單寄不出去。
 * 這裡把每一種寫法都當成可用的鍵；只拆分隔符與括號，不做模糊比對，避免對到別人。
 */
export function nameAliases(raw: string): string[] {
  const full = txt(raw);
  const noParen = full.replace(/[（(][^）)]*[）)]/g, " ");     // 去掉讀音註記
  const parts = [full, noParen, ...noParen.split(/[／\/、,]/)];
  return [...new Set(parts.map(nameKey).filter(Boolean))];
}
/** 「-」在這幾份表裡等同空白。 */
const val = (v: unknown) => { const t = txt(v); return t === "-" ? "" : t; };

/** 只認 http(s) 開頭的才算連結——有人會把 LINE ID 填進這一欄，那個貼給客人是點不動的。 */
export function isLineUrl(v: string): boolean {
  return /^https?:\/\//i.test(txt(v));
}

export function parseDirectory(rows: string[][]): Map<string, DirectoryEntry> {
  const out = new Map<string, DirectoryEntry>();
  if (!rows.length) return out;
  const head = rows[0].map(txt);
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  // 「Line 連結 確認」也含「Line 連結」→ 用完全比對優先，找不到才放寬
  const cLink = head.findIndex((h) => /^line\s*連結$/i.test(h));
  const c = {
    name: col(/Guide Name|導遊姓名|姓名/i),
    phone: col(/手機|電話/),
    link: cLink >= 0 ? cLink : col(/Line\s*連結/i),
    wa: col(/WhatsApp/i),
    wc: col(/WeChat/i),
    email: col(/Guide\s*Email|信箱|E-?mail/i),
  };
  if (c.name < 0) throw new Error(`找不到姓名欄 → 中止。標題列：${head.join(" | ")}`);

  for (const r of rows.slice(1)) {
    const name = txt(r[c.name]);
    if (!name) continue;
    const contacts: Contact[] = [];
    if (c.wa >= 0 && val(r[c.wa])) contacts.push({ type: "WhatsApp", account: val(r[c.wa]) });
    if (c.wc >= 0 && val(r[c.wc])) contacts.push({ type: "WeChat", account: val(r[c.wc]) });
    const entry = {
      name,
      email: c.email >= 0 ? val(r[c.email]) : "",
      phone: c.phone >= 0 ? val(r[c.phone]) : "",
      lineUrl: c.link >= 0 ? val(r[c.link]) : "",
      contacts,
    };
    // 每一種寫法都建索引；先來的不覆蓋，避免後面的人用同一個別名蓋掉前面的
    for (const k of nameAliases(name)) if (!out.has(k)) out.set(k, entry);
  }
  return out;
}

/**
 * 把名單資料轉成 buildScmReminder 要的聯絡方式。
 * LINE 那筆只在**確定是網址**時才送——填成 ID 的話客人點不動，不如讓它缺、被檢查抓出來。
 */
export function contactsFor(e: DirectoryEntry | undefined): { imType: string; imAccount: string; contacts: Contact[] } {
  if (!e) return { imType: "LINE", imAccount: "", contacts: [] };
  return {
    imType: "LINE",
    imAccount: isLineUrl(e.lineUrl) ? e.lineUrl : "",
    contacts: e.contacts,
  };
}
