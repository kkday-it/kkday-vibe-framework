// 投保前資格檢查：身分證/護照格式不合的人「不投保」，另列排除清單。
//
// 規則（Ina 2026-07-27 指定）：
//   本國旅客(nationCode=TW)身分證必須為 1 英文字母 + 9 位數字（共 10 碼）。
//   少一碼、多一碼、含非法字元 → 視為無效 → 不幫他投保。
//   非本國旅客改用護照號碼（非空即可）。
//
// 為了「零人工」又不靜默漏人：排除者不是丟掉，而是回傳到 excluded 清單，
// 由呼叫端輸出成可稽核的紀錄。

import type { NamelistRecord } from "./classify.ts";

// 1 英文字母 + 9 數字。大小寫皆可（真實名單有小寫身分證，屬有效、僅大小寫差異）。
const TW_ID = /^[A-Za-z][0-9]{9}$/;

/**
 * 嚴格驗真實日期：擋掉 13 月、45 日等非法值（會算出錯誤足歲→保額分錯級）。
 * 接受 YYYY-MM-DD 或 YYYY/MM/DD，允許尾端帶時間（如 "2026-07-28 00:00:00"）。
 */
export function isValidYmd(s?: string): boolean {
  const m = (s ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** 中文全名（去空白）。 */
function localName(rec: NamelistRecord): string {
  return [rec.localLastName, rec.localFirstName].filter(Boolean).join("").replace(/\s+/g, "");
}
/** 英文全名（去空白、轉大寫）。 */
function enName(rec: NamelistRecord): string {
  return [rec.enLastName, rec.enFirstName].filter(Boolean).join("").replace(/\s+/g, "").toUpperCase();
}

/** 檢查一列是否可投保；不可投保回傳原因字串，可投保回傳 null。 */
export function insuranceIssue(rec: NamelistRecord): string | null {
  // 日期必須可解析且為真實日期（算足歲、保險起訖都要用），否則不投保、不讓程式崩潰。
  if (!isValidYmd(rec.birthday)) return `生日格式不符：${rec.birthday ?? ""}`;
  if (!isValidYmd(rec.departureDate)) return `出發日格式不符：${rec.departureDate ?? ""}`;
  // 姓名（中或英）不可皆空，否則富邦名冊該列無姓名、代表人也取不到。
  if (!localName(rec) && !enName(rec)) return "缺姓名（中英文皆空）";

  const isTw = (rec.nationCode ?? "").toUpperCase() === "TW";
  if (isTw) {
    const id = (rec.twIdNo ?? "").trim();
    if (!id) return "本國旅客缺身分證字號";
    if (!TW_ID.test(id)) return `身分證字號格式不符（應 1 英文+9 數字）：${id}`;
    return null;
  }
  // 非本國：需有護照號碼
  const pp = (rec.passportNo ?? "").trim();
  if (!pp) return "非本國旅客缺護照號碼";
  return null;
}

export interface ExcludedRecord {
  record: NamelistRecord;
  reason: string;
}

/** 證件號（本國身分證優先，否則護照）。 */
function idKey(rec: NamelistRecord): string {
  return (rec.twIdNo || rec.passportNo || "").trim().toUpperCase();
}

/**
 * 同一群證件號內是否為「不同人」的姓名衝突。
 * 分中文、英文兩語言各自比對：只有當「同語言」出現兩個相異非空姓名才算衝突。
 * 一方缺該語言姓名（空）視為萬用、不算衝突（避免同人一筆填中文一筆填英文被誤刪）。
 */
function hasNameConflict(group: NamelistRecord[]): boolean {
  const locals = new Set(group.map(localName).filter(Boolean));
  const ens = new Set(group.map(enName).filter(Boolean));
  return locals.size > 1 || ens.size > 1;
}

/**
 * 依 Ina 規則處理證件號重複（去重粒度含出團日：跨日的同一人視為不同投保，各自保留）：
 *   同證件號 + 同出團日 + 不同姓名 → 全部刪除（資料衝突，附原因）。
 *   同證件號 + 同出團日 + 同姓名   → 視為同一人同團，只留一筆（去重）。
 *   不同證件號 或 不同出團日        → 各自保留。
 * 無證件號者不在此處理（已由 insuranceIssue 擋掉）。
 */
export function resolveIdConflicts(records: NamelistRecord[]): {
  kept: NamelistRecord[];
  removed: ExcludedRecord[];
} {
  const groups = new Map<string, NamelistRecord[]>();
  const kept: NamelistRecord[] = [];
  const removed: ExcludedRecord[] = [];
  for (const r of records) {
    const k = idKey(r);
    if (!k) { kept.push(r); continue; }
    // 去重鍵含出團日：同一人若在不同出團日各有一筆，是不同團的兩張保單，不可 dedup 掉。
    const gk = `${k}|${(r.departureDate ?? "").trim()}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(r);
  }
  for (const [gk, group] of groups) {
    if (hasNameConflict(group)) {
      // 同證件號同出團日不同姓名 → 全刪
      const id = gk.split("|")[0];
      for (const r of group)
        removed.push({ record: r, reason: `同身分證同出團日不同姓名，資料衝突（${id}）` });
    } else {
      // 同證件號同出團日同姓名 → 只留一筆
      kept.push(group[0]);
    }
  }
  return { kept, removed };
}

/** 把名單切成「可投保」與「排除（附原因）」兩堆。 */
export function partitionInsurable(records: NamelistRecord[]): {
  insurable: NamelistRecord[];
  excluded: ExcludedRecord[];
} {
  const insurable: NamelistRecord[] = [];
  const excluded: ExcludedRecord[] = [];
  for (const rec of records) {
    const reason = insuranceIssue(rec);
    if (reason) excluded.push({ record: rec, reason });
    else insurable.push(rec);
  }
  return { insurable, excluded };
}
