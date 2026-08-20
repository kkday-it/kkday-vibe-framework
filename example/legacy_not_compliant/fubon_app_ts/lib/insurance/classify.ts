// 富邦旅平險 — 名單分類核心邏輯
//
// 輸入：Data team 寄到 jptour-operation@kkday.com 的名單（每列一位旅客，
// 欄位沿用 BigQuery 匯出的 order_cus_* 命名）。
// 輸出：依「保額」與「天數」分好的 6 個桶，供後續逐桶登入富邦 B2B 投保。
//
// 分類規則（2026-07 對實際名單驗證）：
//   保額（看足歲，基準日 = 出發日）
//     未滿 15 歲            → 250 萬（保險法 §107 未成年喪葬給付上限）
//     15 ~ 69 歲           → 500 萬（一般成人）
//     70 歲以上            → 250 萬（高齡投保上限）
//   天數桶：由行程時長進位成日數（1 / 2 / 3 日）。
//
// 純函式、無 I/O，方便測試，也與富邦網頁自動化那塊解耦。

/** 保額（新台幣萬元）。目前只有兩級。 */
export type CoverageWan = 250 | 500;

/** Data team 名單的一列（只列分類會用到的欄位）。 */
export interface NamelistRecord {
  /** 中文姓 order_cus_local_last_name */
  localLastName?: string;
  /** 中文名 order_cus_local_first_name */
  localFirstName?: string;
  /** 英文姓 order_cus_en_last_name */
  enLastName?: string;
  /** 英文名 order_cus_en_first_name */
  enFirstName?: string;
  /** 生日，YYYY-MM-DD */
  birthday: string;
  /** 台灣身分證字號 order_cus_tw_id_no */
  twIdNo?: string;
  /** 護照號碼 order_cus_passport_no */
  passportNo?: string;
  /** 國籍碼 order_cus_nation_code，如 "TW" */
  nationCode?: string;
  /** 性別 order_cus_gender，如 "M" / "F" */
  gender?: string;
  /** 出發日 lst_dt_go，YYYY-MM-DD（= 保險生效日 = 足歲基準日） */
  departureDate: string;
  /** 行程時長 prod_tour_day，如 "0 Day 10 Hour" */
  prodTourDay?: string;
  /** 商品編號 prod_oid */
  prodOid?: string;
  /** 中文品名 prod_name_zh_tw */
  prodNameZh?: string;
}

/** 分類後的旅客（原始資料 + 算出來的保額/天數）。 */
export interface ClassifiedTraveler extends NamelistRecord {
  ageAtDeparture: number;
  coverageWan: CoverageWan;
  tourDays: number;
  /** 桶代碼，如 "3day-500"。 */
  bucketKey: string;
}

/** 一個投保桶（拿去富邦一批投保的單位）。 */
export interface Bucket {
  key: string;
  /** 出團日 YYYY-MM-DD（= 保險生效日；同桶必為同一日）。 */
  departureDate: string;
  tourDays: number;
  coverageWan: CoverageWan;
  travelers: ClassifiedTraveler[];
}

// 保額分界（歲）。抽成常數，日後富邦調規則時只改這裡。
const MINOR_MAX_AGE = 15; // 未滿 15 歲 → 250 萬
const SENIOR_MIN_AGE = 70; // 70 歲以上 → 250 萬

/**
 * 足歲：以 asOf 當天計算滿幾歲（生日當天才進位）。
 * birthday / asOf 皆為 YYYY-MM-DD。
 */
export function ageOn(birthday: string, asOf: string): number {
  const b = parseYmd(birthday);
  const a = parseYmd(asOf);
  let age = a.y - b.y;
  // 今年生日還沒到就減一歲。
  if (a.m < b.m || (a.m === b.m && a.d < b.d)) age -= 1;
  return age;
}

/** 依足歲定保額。 */
export function coverageForAge(age: number): CoverageWan {
  if (age < MINOR_MAX_AGE || age >= SENIOR_MIN_AGE) return 250;
  return 500;
}

/**
 * 由 prod_tour_day 推算投保日數。
 * 格式 "N Day M Hour"。小時數不影響天數。
 *   0 Day（只有小時，當天來回）→ 1 日
 *   1 Day → 2 日　※跨夜的「一日遊」實際橫跨兩個日曆天（例 579223 長岡花火，Ina 2026-08-05 指正）
 *   2 Day 以上 → N 日（黑部立山 3 Day → 3 日，2026-07 真實投保驗證，不動）
 */
export function tourDaysFrom(prodTourDay?: string): number {
  if (!prodTourDay) return 1;
  const m = prodTourDay.match(/(\d+)\s*Day/i);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  if (n <= 0) return 1;
  if (n === 1) return 2;
  return n;
}

/** 分類單一旅客。 */
export function classifyTraveler(rec: NamelistRecord): ClassifiedTraveler {
  const ageAtDeparture = ageOn(rec.birthday, rec.departureDate);
  const coverageWan = coverageForAge(ageAtDeparture);
  const tourDays = tourDaysFrom(rec.prodTourDay);
  return {
    ...rec,
    ageAtDeparture,
    coverageWan,
    tourDays,
    // 出團日前綴：同名單保證單一出團日（Ina 2026-07-28），加日期為防呆——
    // 萬一名單混入不同出團日，也會拆成各自的桶/申報，不會全用第一人的日期。
    bucketKey: `${rec.departureDate}|${tourDays}day-${coverageWan}`,
  };
}

/**
 * 把整份名單分成投保桶。回傳的桶依 (天數, 保額) 穩定排序，方便逐桶作業。
 */
export function classifyNamelist(records: NamelistRecord[]): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const rec of records) {
    const t = classifyTraveler(rec);
    let bucket = buckets.get(t.bucketKey);
    if (!bucket) {
      bucket = {
        key: t.bucketKey,
        departureDate: t.departureDate,
        tourDays: t.tourDays,
        coverageWan: t.coverageWan,
        travelers: [],
      };
      buckets.set(t.bucketKey, bucket);
    }
    bucket.travelers.push(t);
  }
  return [...buckets.values()].sort(
    (a, b) =>
      a.departureDate.localeCompare(b.departureDate) ||
      a.tourDays - b.tourDays ||
      a.coverageWan - b.coverageWan
  );
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  // 接受 "2026-07-27" 或 "2026/07/27"。
  const m = s.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) throw new Error(`日期格式無法解析：${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}
