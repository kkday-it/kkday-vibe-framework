// 把 Data team 名單 CSV（BigQuery 匯出、order_cus_* 欄位）解析成 NamelistRecord[]。
// 依欄名對應（非位置），欄序日後有變也不會錯位。

import type { NamelistRecord } from "./classify.ts";

/** 解析一小段 CSV（支援雙引號包住的欄位、跳脫 ""）。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** 名單 CSV → NamelistRecord[]。空白列自動略過。 */
export function parseNamelistCsv(text: string): NamelistRecord[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  // 有些名單把 first 拼成 frist（Data team 原始欄名如此），兩種都收。
  const idxAny = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const cBirthday = idx("order_cus_birthday");
  const cGo = idx("lst_dt_go");
  const cTourDay = idx("prod_tour_day");
  if (cBirthday < 0 || cGo < 0) {
    throw new Error(
      "名單缺少必要欄位 order_cus_birthday / lst_dt_go，請確認是 Data team 的原始格式"
    );
  }
  const get = (r: string[], c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");

  return rows.slice(1).map((r) => ({
    localLastName: get(r, idx("order_cus_local_last_name")),
    localFirstName: get(r, idxAny("order_cus_local_first_name", "order_cus_local_frist_name")),
    enLastName: get(r, idx("order_cus_en_last_name")),
    enFirstName: get(r, idxAny("order_cus_en_first_name", "order_cus_en_frist_name")),
    birthday: get(r, cBirthday),
    twIdNo: get(r, idx("order_cus_tw_id_no")),
    passportNo: get(r, idx("order_cus_passport_no")),
    nationCode: get(r, idx("order_cus_nation_code")),
    gender: get(r, idx("order_cus_gender")),
    departureDate: get(r, cGo),
    prodTourDay: get(r, cTourDay),
    prodOid: get(r, idx("prod_oid")),
    prodNameZh: get(r, idx("prod_name_zh_tw")),
  }));
}
