/**
 * 30651 京都嵐山半日遊的 **D-1 供應商 FNL 通知**（Ina 2026-08-16）。
 *
 * 出發前一天要對兩家供應商發「最終人數」：
 *   京馬車    info@kyobasha.jp        時間取一覧表的 L 欄
 *   保津川遊船 hozugawaboat@gmail.com  時間取 M 欄，**外加一條名簿連結**
 *
 * 名簿是保津川用來投保的，所以連結指向的那一頁每天被改寫：
 * 頁籤改名成出發日、內容換成當天的旅客。**連結永遠不變，因為一直是同一個 gid。**
 *
 * 幾個從現有信件與試算表看出來、影響做法的事實：
 *  - 一覧表的 **F 欄就是「寄過了沒」**（TRUE/FALSE）→ 拿它當冪等依據，不另外做台帳。
 *  - `幼児` 永遠是 0：**兩歲以下不佔位也不能下訂**，客人多半寫在備註，
 *    超過 80 公分要現場自費買船票——那不是 OP／AM 要處理的事，
 *    所以備註裡提到嬰兒**不進 FNL 人數**，看到也不要去改（Ina 2026-08-16）。
 *  - 添乗員（TG）不算在大人／子供裡，是額外的 `+1TG`。
 */

/** 成人／兒童分界（Ina 2026-08-16）：13 歲以上（含）算大人，12 歲以下（含）算子供。 */
export const ADULT_FROM_AGE = 13;

export type FnlPax = {
  /** 護照英文姓名，跟名簿現有格式一致（例 `TZU-YUN WANG`） */
  name: string;
  /** `男` / `女` */
  gender: string;
  age: number;
  /** 國籍代碼（例 `TW`） */
  nationality: string;
};

export type FnlCounts = { adult: number; child: number; infant: number; total: number };

/**
 * 人數分類。`infant` 恆為 0——見檔頭：兩歲以下根本不會出現在名單上。
 * 保留這個欄位是因為信件格式有這一格，不是因為它會有值。
 */
export function countPax(pax: FnlPax[]): FnlCounts {
  const adult = pax.filter((p) => p.age >= ADULT_FROM_AGE).length;
  return { adult, child: pax.length - adult, infant: 0, total: pax.length };
}

/** 一覧表上那一列。欄位一律用標題文字找，不寫死欄號。 */
export type ScheduleRow = {
  /** 試算表列號（1-based），打勾要寫回同一列 */
  row: number;
  tourCode: string;
  /** `2026/8/17( 月)` 原樣 */
  dateText: string;
  /** E 欄 募集人数(TG含み) */
  headcount: number | null;
  /** F 欄 FNL：true＝已經寄過 */
  sent: boolean;
  /** G 欄 ガイド資料，例 `森山明明 080-6109-0963` */
  guide: string;
  /** L 欄 京馬車乗車時間，例 `10:35` */
  kyobashaTime: string;
  /** M 欄 保津川下り，例 `11:00-11:30乗船` */
  hozugawaTime: string;
};

const cell = (r: string[], i: number) => (i < 0 ? "" : String(r[i] ?? "").trim());

/**
 * 解析一覧表。找不到必要欄位就 **throw**，不要安靜回空——
 * 「今天沒有團」跟「欄位改名所以讀不到」長得一樣，後者會讓供應商收不到通知。
 */
export function parseSchedule(rows: string[][]): ScheduleRow[] {
  const hdrAt = rows.findIndex((r) => r.some((c) => /団体名/.test(String(c ?? ""))));
  if (hdrAt < 0) throw new Error("一覧表找不到「団体名」標題列 → 已中止，避免漏發 FNL");
  const hdr = (rows[hdrAt] ?? []).map((c) => String(c ?? "").trim());
  const at = (re: RegExp) => hdr.findIndex((c) => re.test(c));
  const cTour = at(/団体名/), cDate = at(/催行日/), cHead = at(/募集人数/),
    cSent = at(/^FNL$/i), cGuide = at(/ガイド資料/),
    cKyo = at(/京馬車/), cHozu = at(/保津川/);
  for (const [name, idx] of [["FNL", cSent], ["京馬車乗車時間", cKyo], ["保津川下り", cHozu]] as const) {
    if (idx < 0) throw new Error(`一覧表找不到「${name}」欄（標題：${hdr.filter(Boolean).join(" | ")}）→ 已中止`);
  }
  const out: ScheduleRow[] = [];
  for (let i = hdrAt + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const tourCode = cell(r, cTour);
    if (!/^KK\d{6}-\d+/.test(tourCode)) continue;   // 月份分隔列、空列都跳過
    const head = cell(r, cHead).replace(/[^\d]/g, "");
    out.push({
      row: i + 1,
      tourCode,
      dateText: cell(r, cDate),
      headcount: head ? Number(head) : null,
      sent: /^(TRUE|true|✓|V|是)$/.test(cell(r, cSent)),
      guide: cell(r, cGuide),
      kyobashaTime: cell(r, cKyo),
      hozugawaTime: cell(r, cHozu),
    });
  }
  return out;
}

/** 出發日 `2026-08-17` → 團號前綴 `KK260817`。 */
export const tourPrefix = (date: string) => `KK${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;

/** 找出發日那一列。同一天同一商品只會有一列。 */
/** FNL 只服務這條行程（京都嵐山半日遊）。判斷「今天要不要管 FNL」一律用它。 */
export const FNL_PRODUCT_NO = "30651";

export function rowForDate(rows: ScheduleRow[], date: string, productNo = FNL_PRODUCT_NO): ScheduleRow | undefined {
  return rows.find((r) => r.tourCode.startsWith(`${tourPrefix(date)}-${productNo}`));
}

/** 名簿頁籤名字＝出發日 MMDD（Ina 2026-08-16）。 */
export const rosterTabName = (date: string) => `${date.slice(5, 7)}${date.slice(8, 10)}`;

/**
 * 信件裡的利用日字串。一覧表的 M 欄是 `11:00-11:30乗船`，
 * 現有信件寫成 `11:00~11:30`——去掉「乗船」、連字號換成全形波浪，跟人手寫的一致。
 */
export function useTime(raw: string): string {
  return raw.replace(/乗船|乘船/g, "").trim().replace(/\s*-\s*/g, "~");
}

/** `08/17`。信件裡的利用日格式。 */
export const mmdd = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

export type FnlInput = {
  date: string;
  row: ScheduleRow;
  counts: FnlCounts;
  pax: FnlPax[];
  /** 名簿那一頁的網址（gid 固定，不隨日期變） */
  rosterUrl: string;
};

/** 兩家供應商的收件地址。 */
export const KYOBASHA_TO = "info@kyobasha.jp";
export const HOZUGAWA_TO = "hozugawaboat@gmail.com";
/**
 * JP OP 的共用信箱。**每一封對外的信都要 CC 這裡**（Ina 2026-08-18）——
 * 供應商 FNL、寄給導遊的名單都算。個人信箱會離職、會請假，共用信箱不會。
 */
export const OPS_CC = "jptour-operation@kkday.com";

/** 兩封信共用的中段。 */
function core(i: FnlInput, time: string): string {
  const c = i.counts;
  return [
    `団体名：${i.row.tourCode}`,
    `利用日：${mmdd(i.date)} ${time}`,
    `FNL人数：${c.total}+1TG（大人：${c.adult}名 子供：${c.child}名 幼児：${c.infant}名 添乗：1名）`,
    `添乗員：${i.row.guide}`,
  ].join("\n");
}

const SIGN = ["", "どうぞよろしくお願い致します。", "", "ツアーチーム Tour Team", "株式会社KKDAY JAPAN"].join("\n");

export type FnlMail = { to: string; cc: string; subject: string; body: string };

/** 京馬車：不附名簿。 */
export function kyobashaMail(i: FnlInput): FnlMail {
  return {
    to: KYOBASHA_TO, cc: OPS_CC,
    subject: `【KKDAY JAPAN】${i.row.tourCode} 京馬車FNL`,
    body: [
      "株式会社 京馬車", "千葉 様", "",
      "お世話になっております。", "KKDAY JAPANのツアーチームでございます。", "",
      "早速ですが、明日のファイナルの情報をお送り致します。", "",
      core(i, useTime(i.row.kyobashaTime)),
      SIGN,
    ].join("\n"),
  };
}

/** 保津川：多一條名簿連結（他們拿去投保）。 */
export function hozugawaMail(i: FnlInput): FnlMail {
  return {
    to: HOZUGAWA_TO, cc: OPS_CC,
    subject: `【KKDAY JAPAN】${i.row.tourCode}保津川遊船FNL`,
    body: [
      "保津川遊船企業組合", "山門様", "谷口様", "",
      "お世話になっております。", "KKDAY JAPANのツアーチームでございます。", "",
      "早速ですが、明日のファイナルの情報をお送り致します。", "",
      core(i, useTime(i.row.hozugawaTime)), "",
      "参加者名簿", i.rosterUrl,
      SIGN,
    ].join("\n"),
  };
}

/**
 * 名簿那一頁要寫進去的整塊內容（含抬頭、欄名、旅客、TG 三行）。
 *
 * **年齢要送數字不是字串**：現有那頁存的是數字（靠右對齊），送 `"15"` 會變成文字、
 * 靠左對齊，一眼就看得出是機器貼的。抬頭與欄名的粗體不用管——
 * 我們只清內容（values.clear）不清格式，原本的樣式會留在那裡。
 */
export function rosterValues(i: FnlInput, title: string): (string | number)[][] {
  return [
    [title],
    ["氏名", "性別", "年齢", "国籍"],
    ...i.pax.map((p) => [p.name, p.gender, p.age, p.nationality]),
    [""],
    ["TG："],
    [i.row.guide],
    [`人数：${i.counts.total}+1TG`],
  ];
}

/**
 * 寄之前的把關。回傳的每一條都是「不該寄」的理由——**有任何一條就整個停下來**。
 * 對外的數字寧可不寄，也不要寄錯：供應商拿這個數字準備船位與保險。
 */
export function blockers(i: FnlInput): string[] {
  const b: string[] = [];
  if (!i.pax.length) b.push("名單上一個人都沒有");
  if (!i.row.guide) b.push("一覧表 G 欄沒有添乗員");
  if (!i.row.kyobashaTime) b.push("一覧表 L 欄沒有京馬車乗車時間");
  if (!i.row.hozugawaTime) b.push("一覧表 M 欄沒有保津川時間");
  // TG 含み → 名單人數 + 1 應該等於 E 欄。對不上代表兩邊有一邊過時了。
  if (i.row.headcount !== null && i.row.headcount !== i.counts.total + 1) {
    b.push(`人數對不上：名單 ${i.counts.total} 人 +1TG = ${i.counts.total + 1}，但一覧表 E 欄寫 ${i.row.headcount}`);
  }
  if (i.pax.some((p) => !Number.isFinite(p.age))) b.push("有旅客算不出年齡（生日缺漏或格式怪）");
  if (i.pax.some((p) => !p.name.trim())) b.push("有旅客沒有護照英文名");
  return b;
}
