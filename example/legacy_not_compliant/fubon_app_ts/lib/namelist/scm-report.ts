/**
 * 解析 SCM Customers Report（下載名單 CSV）。
 *
 * 為什麼寫得這麼防禦：
 *  1. **欄名有中英兩種**——匯出語言跟著操作者 SCM 介面語系跑（日本團匯出是「訂單編號」，
 *     F1 匯出是「Booking no.」）。所以一律按欄名（雙語別名）找欄，不用欄號。
 *  2. **不同商品的欄位組不一樣**——同一個欄號在不同檔可能是語系、電話或 email。同上，只認欄名。
 *  3. **一張訂單多列**：首列有訂單資訊，同訂單的其他旅客那幾列訂單欄留空 → 需向下補值。
 *  4. 第 0 列是分組抬頭（訂單資訊／旅客資料…），**第 1 列才是真標題**。
 *  5. 編碼是 UTF-8 with BOM；在 Excel 開會看到亂碼但檔案本身正常。
 */

/** 欄位別名：一個語意欄 → 可能出現的中／英標題。 */
const FIELDS = {
  bookingNo: ["訂單編號", "Booking no."],
  orderStatus: ["訂單狀態", "Order Status"],
  departureDate: ["出發日期", "Departure Date"],
  bookingDate: ["訂購日期", "Booking Date"],
  productNo: ["商品編號", "Product No."],
  productName: ["商品名稱", "Product's Name"],
  packageName: ["套餐名稱", "Package Name"],
  quantity: ["數量", "Quantity"],
  adults: ["成人", "Number of adults"],
  children: ["兒童", "Number of children"],
  infants: ["幼童", "Number of infants"],
  buyer: ["訂購人", "Buyer"],
  buyerPhone: ["訂購人電話", "Buyer's Phone Number"],
  tourLanguage: ["導覽語言", "Tour Language"],
  note: ["備註", "Note"],
  enFirstName: ["旅客護照名（英文）", "Passport First Name (English)"],
  enLastName: ["旅客護照姓（英文）", "Passport Surname Name (English)"],
  gender: ["性別", "Gender"],
  nationality: ["國籍", "Nationality"],
  localFirstName: ["名", "First name"],
  localLastName: ["姓氏", "Last name"],
  birthday: ["生日", "Customer Birthday", "旅客生日"],
  messenger: ["APP聯絡方式", "Contact via mobile messenger", "通訊軟體"],
} as const;

export type Field = keyof typeof FIELDS;
/** 訂單層欄位：同訂單續列會留空，需向下補值。旅客層欄位不補。 */
const ORDER_LEVEL: Field[] = [
  "bookingNo", "orderStatus", "departureDate", "bookingDate", "productNo",
  "productName", "packageName", "quantity", "adults", "children", "infants",
  "buyer", "buyerPhone", "tourLanguage", "note",
];

export type Traveler = Record<Field, string> & {
  rowNo: number;
  /**
   * 供應商 OID（DAP 的「供應商編號 Supplier OID」欄）。
   * 回填 SCM 一定要有：**SCM 一次只服務一家供應商**，寫之前得先切到擁有這張單的那家，
   * 否則讀到的是「訂單資料不存在」，跟真的不存在長得一模一樣
   *（2026-08-18 17:00 全滅就是這個）。SCM 匯出的那份 CSV 沒有這欄 → 允許 undefined。
   */
  supplierOid?: number;
  /** 規格1／2／3 的值（只留有填的）。包車商品的路線就在這裡，見 guide-namelist.meaningfulSpecs。 */
  specs?: string[];
};

/** 極簡 CSV 解析（處理引號、跨行欄位、CRLF）。避免為此加一個依賴。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const CANCELLED = /已取消|取消|Cancel/i;

export type ParseResult = {
  travelers: Traveler[];
  /** 找不到的欄位（該商品匯出沒有這欄，或欄名又換了）→ 交代給人看，不靜靜漏掉。 */
  missingFields: Field[];
  skippedCancelled: number;
  headerRow: number;
};

export function parseCustomersReport(text: string): ParseResult {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 3) return { travelers: [], missingFields: [], skippedCancelled: 0, headerRow: -1 };

  // 找標題列：含「訂單編號」或「Booking no.」的那列（通常是第 1 列，第 0 列是分組抬頭）
  const headerRow = rows.findIndex((r) =>
    r.some((c) => FIELDS.bookingNo.includes(c.trim() as never)));
  if (headerRow < 0) throw new Error("找不到標題列（沒有『訂單編號』或『Booking no.』欄）");
  const header = rows[headerRow].map((c) => c.trim());

  const idx = {} as Record<Field, number>;
  const missingFields: Field[] = [];
  for (const key of Object.keys(FIELDS) as Field[]) {
    const i = header.findIndex((h) => (FIELDS[key] as readonly string[]).includes(h));
    idx[key] = i;
    if (i < 0) missingFields.push(key);
  }

  const travelers: Traveler[] = [];
  const carry = {} as Record<Field, string>;
  let skippedCancelled = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;
    const get = (k: Field) => (idx[k] >= 0 ? (row[idx[k]] ?? "").trim() : "");

    // ⚠️ 只在「同一張訂單的續列」才補值。看到新的訂單編號就整組重置——
    // 否則上一張訂單的備註／語系會灌到下一張訂單（實測 20 人的團裡有 17 人被灌到同一句備註）。
    const isNewOrder = !!get("bookingNo");
    if (isNewOrder) for (const k of ORDER_LEVEL) carry[k] = get(k);

    const rec = {} as Traveler;
    for (const key of Object.keys(FIELDS) as Field[]) {
      let v = get(key);
      if (ORDER_LEVEL.includes(key) && !v) v = carry[key] ?? "";   // 續列補同訂單資料
      rec[key] = v;
    }
    rec.rowNo = r + 1;

    // 沒有任何旅客姓名 → 不是旅客列（可能是小計/空列）
    if (!rec.enLastName && !rec.enFirstName && !rec.localLastName && !rec.localFirstName) continue;
    if (CANCELLED.test(rec.orderStatus)) { skippedCancelled++; continue; }
    travelers.push(rec);
  }

  return { travelers, missingFields, skippedCancelled, headerRow };
}

/** 出發日當天的足歲。生日或出發日不合法回 -1（呼叫端要把它列成待確認）。 */
export function ageOn(birthday: string, departure: string): number {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(departure);
  if (!b || !d) return -1;
  let age = +d[1] - +b[1];
  if (+d[2] < +b[2] || (+d[2] === +b[2] && +d[3] < +b[3])) age--;
  return age < 0 || age > 120 ? -1 : age;
}

/** 「Line/monicalovecat」→ { type:"Line", account:"monicalovecat" }；也吃「+886-9…」這種只有電話的。 */
export function splitMessenger(v: string): { type: string; account: string } {
  const s = (v ?? "").trim();
  if (!s) return { type: "", account: "" };
  const m = /^([A-Za-z]+)\s*[/:：]\s*(.+)$/.exec(s);
  if (m) return { type: m[1], account: m[2].trim() };
  return { type: "", account: s };
}
