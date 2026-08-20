/**
 * 把 DAP（BigQuery → Google Sheet Connected Sheet）的名單轉成既有的 Traveler 格式，
 * 讓下游的 buildNamelist 完全不用知道資料換了來源。
 *
 * 為什麼需要這一層（都是實際資料裡看到的，不是預想）：
 *  1. **欄名是中英合併**：「訂單編號 Booking No」——跟 SCM 匯出的「訂單編號」不相等，
 *     所以用「開頭符合」比對，不是完全相等。
 *  2. **空值是字串 "null"**：不轉成空字串的話，導遊會看到一整排 null，
 *     而且「備註提到分車就標記」的判斷會把 null 當成有內容。
 *  3. **訂購日期已經是 JST**：Data Team 那端轉過了，這裡**不可以再轉一次**。
 *  4. **電話國碼後面還留著 0**：「+886 0910759828」這樣撥不通。導遊真的會照名單打。
 *  5. **英文姓名大小寫混亂**：CHEN／Chow／wong 三種都有，統一大寫。
 *  6. **生日是 YYYYMMDD**，ageOn 要 YYYY-MM-DD。
 *  7. **APP 聯絡方式是訂購人（代表人）那一筆**，不是每位旅客各自的 → 欄位標題要講明白。
 *
 * 多日遊（供應商 27883）在這裡就濾掉——AM 自己會寄，機器人再寄一次導遊會收到兩份。
 * ⚠️ 這條規則**還沒被真實資料驗證過**（8/14 那批沒有多日遊的團）。
 *
 * ⚠️ **fail-closed**：Connected Sheet 若刷新失敗，不會報錯，就是留著昨天的資料。
 * 照跑的話導遊會拿到錯誤的一整份名單，所以這裡驗出發日不符就直接中止。
 */
import type { Field, Traveler } from "./scm-report.ts";

/** Data Team 的 Connected Sheet：每天刷新成「明天出發」那批。 */
export const DAP_SHEET_ID = "1Y-EOkFI0RFGW8Hf7SHcjtlXfRMr-k4ynkBj2yz2DPPc";
export const DAP_TAB = "D-1";

/** DAP 欄名（開頭比對即可）→ 內部欄位。 */
const DAP_COLUMNS: Array<[string, Field]> = [
  ["訂單編號", "bookingNo"],
  ["訂單狀態", "orderStatus"],
  ["出發日期", "departureDate"],
  ["訂購日期", "bookingDate"],
  // 供應商 OID 沒有對應的 Traveler 欄位，另外抓（見 SUPPLIER_LABEL）
  ["商品編號", "productNo"],
  ["商品名稱", "productName"],
  ["套餐名稱", "packageName"],
  ["訂購人電話", "buyerPhone"],
  // Ina 2026-08-13 把來源從「導覽語言」換成「訂單語系」：後者是客人下單時用的語言，
  // 才是罐頭訊息該用的語系（導覽語言是這團現場講什麼，兩者不一定一樣）。
  // 兩個名字都認：舊版 Connected Sheet 還沒換欄名時不會整批空白。
  ["訂單語系", "tourLanguage"],
  ["導覽語言", "tourLanguage"],
  ["備註", "note"],
  ["護照姓", "enLastName"],
  ["護照名", "enFirstName"],
  ["性別", "gender"],
  ["生日", "birthday"],
  ["國籍", "nationality"],
  ["APP聯絡方式", "messenger"],
];

/**
 * appType 代碼對照。全表 enum 分佈已經掃過（2026-08-13，共 8 種代碼）：
 *
 *   0001  187 萬  本地手機號／純數字 ID        → LINE（已確認）
 *   0002   95 萬  100% 是 +國碼 國際電話       → WhatsApp（幾乎可確定）
 *   0003   21 萬  英數 ID                      → 疑似 WeChat，未確認
 *   0004   36 萬  韓風英數 ID                  → 疑似 KakaoTalk，未確認
 *   0005    4 千  +國碼 電話（美國／菲律賓多） → 電話型 app（Viber／Zalo 類），未確認
 *   0006     46   英數 ID                      → 未確認
 *   0007    1 萬  真實姓名／email              → 疑似 Facebook Messenger，未確認
 *   0008    405   @handle                      → 疑似 Instagram 或 Telegram，未確認
 *
 * ⚠️ **只對照確認過的兩個**。0003／0004 都是英數 ID，長相分不出 WeChat 與 KakaoTalk，
 * 對調著猜會叫客人去加錯的軟體。其餘代碼原樣保留 → 名單上會印「0003（軟體待確認）」
 * 並列進當天警告，看得出來是待確認，不會默默出錯。
 * 要收掉這些待確認：跟 SCM／前端要 contactApp.appType 的正式 enum 字典（下單頁 messenger 下拉就是這份）。
 */
const APP_TYPE: Record<string, string> = { "0001": "Line", "0002": "WhatsApp" };

/** BigQuery 匯出的空值會變成字串 "null"／"NULL"，要當成空的。 */
const clean = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return /^(null|NULL|#N\/A)$/.test(s) ? "" : s;
};

/** 「+886 0910759828」→「+886 910759828」。國碼後面的 0 是國內冠碼，國際撥號要去掉。 */
export function fixPhone(v: string): string {
  const s = clean(v);
  const m = /^(\+\d{1,4})\s*0(\d+)$/.exec(s.replace(/[-\s]+/g, " ").trim());
  return m ? `${m[1]} ${m[2]}` : s;
}

/**
 * 日期一律轉成 YYYY-MM-DD。
 *
 * Google Sheet 會照試算表的地區設定把日期渲染成 **8/14/2026**（美式 M/D/YYYY），
 * 不是 BigQuery 原本的 2026-08-14——直接字串比對會整批判定「日期不符」而中止。
 * 兩種格式都收；認不出來的原樣回傳，讓上層的日期檢查去擋。
 */
export function normalizeDate(v: string): string {
  const s = clean(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return s;
}

/** 19740329 → 1974-03-29。已經是 YYYY-MM-DD 就原樣回。 */
export function normalizeBirthday(v: string): string {
  const s = clean(v);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

/** 「0001 / py329」→「Line/py329」，交給既有的 splitMessenger 拆。 */
export function normalizeMessenger(v: string): string {
  const s = clean(v);
  if (!s) return "";
  const m = /^(\d{4})\s*\/\s*(.*)$/.exec(s);
  if (!m) return s;
  const account = m[2].trim();
  if (!account) return "";
  return `${APP_TYPE[m[1]] ?? m[1]}/${account}`;
}

/** 護照姓名大小寫混亂（CHEN／Chow／wong），統一大寫。 */
const upper = (v: string) => clean(v).toUpperCase();

/** 「8/3/2026 20:15:48」→「2026-08-03 20:15」。已是 ISO 就只截到分。 */
export function normalizeBookingDate(v: string): string {
  const s = clean(v);
  const m = /^(\S+)[ T](\d{1,2}):(\d{2})/.exec(s);
  if (!m) return normalizeDate(s);
  const d = normalizeDate(m[1]);
  return `${d} ${m[2].padStart(2, "0")}:${m[3]}`;
}

const EMPTY: Record<Field, string> = {
  bookingNo: "", orderStatus: "", departureDate: "", bookingDate: "", productNo: "",
  productName: "", packageName: "", quantity: "", adults: "", children: "", infants: "",
  buyer: "", buyerPhone: "", tourLanguage: "", note: "", enFirstName: "", enLastName: "",
  gender: "", nationality: "", localFirstName: "", localLastName: "", birthday: "", messenger: "",
};

/** 多日遊（兩天以上）由 AM 自己寄名單，機器人不寄——Ina 2026-08-13。 */
export const MULTI_DAY_SUPPLIER = 27883;

const SUPPLIER_LABEL: Record<number, string> = {
  1894: "關東", 9675: "關西", 24276: "九州", 24277: "名古屋", 24278: "北海道", 27883: "多日遊",
};

export type DapResult = {
  travelers: Traveler[];
  /** 被排除的非成立訂單（狀態不是 GO）：狀態 → 列數 */
  skippedCancelled: number;
  /** 被排除的各種狀態明細，要講出來（8 筆 FAIL 曾被靜靜放進名單） */
  skippedByStatus: { status: string; rows: number }[];
  /** 找不到的欄位，供上層提醒 */
  missingColumns: string[];
  /** 多日遊被排除掉的商品與人數（要在 Slack 講出來，不能安靜跳過） */
  skippedMultiDay: { productNo: string; travelers: number }[];
  /** 出現過的供應商，供上層核對 */
  suppliers: number[];
};

/**
 * @param values Sheet 讀回來的二維陣列，第 0 列是標題
 * @param expectedDate 預期的出發日（YYYY-MM-DD）。任一列不符就中止——見上面 fail-closed 說明。
 */
export function parseDapNamelist(values: string[][], expectedDate: string): DapResult {
  const rows = (values ?? []).filter((r) => r.some((c) => clean(c) !== ""));
  if (rows.length === 0) throw new Error("DAP 名單是空的（連標題列都沒有）→ 中止，不當成今天沒有團");

  const header = rows[0].map((h) => clean(h));
  const colOf = new Map<Field, number>();
  const missingColumns: string[] = [];
  for (const [label, field] of DAP_COLUMNS) {
    const i = header.findIndex((h) => h.startsWith(label));
    // 同一個欄位可以有多個可接受的欄名（例：訂單語系／導覽語言）→ 先找到的算數，
    // 別把「另一個別名沒出現」報成缺欄位
    if (i >= 0) { if (!colOf.has(field)) colOf.set(field, i); }
    else if (!colOf.has(field) && !DAP_COLUMNS.some(([l, f]) => f === field && l !== label && header.some((h) => h.startsWith(l)))) {
      missingColumns.push(label);
    }
  }
  for (const must of ["bookingNo", "departureDate", "birthday"] as Field[]) {
    if (!colOf.has(must)) throw new Error(`DAP 名單缺少必要欄位（${must}）→ 中止。標題列：${header.join(" | ")}`);
  }

  const get = (r: string[], f: Field) => {
    const i = colOf.get(f);
    return i === undefined ? "" : clean(r[i]);
  };

  // 供應商欄是後來才加的；沒有這欄時不能默默當成「全部都要寄」
  // 規格欄：DAP 2026-08-18 加的。**位置代表的意義因商品而異**——
  // 多數商品規格1 是票種，但包車商品（196022／265887／170052／268173）規格1 是路線、
  // 規格2 才是票種。所以只照順序收值，不在這裡假設哪一欄是什麼。
  const specCols = [1, 2, 3].map((n) => header.findIndex((h) => h.startsWith(`規格${n}`)));
  const supplierCol = header.findIndex((h) => h.startsWith("供應商"));
  if (supplierCol < 0) missingColumns.push("供應商OID");

  const travelers: Traveler[] = [];
  let skippedCancelled = 0;
  const byStatus = new Map<string, number>();
  const wrongDate: string[] = [];
  const multiDay = new Map<string, number>();
  const suppliers = new Set<number>();

  rows.slice(1).forEach((r, n) => {
    const departureDate = normalizeDate(get(r, "departureDate"));
    if (departureDate !== expectedDate) { wrongDate.push(`${get(r, "bookingNo")}＝${departureDate || "空白"}`); return; }
    // **只收 GO**（Ina 2026-08-15）。原本只排除 CX 是黑名單寫法，
    // 於是 FAIL（付款失敗／未完成）整批被放進名單——2026-08-15 這天就有 8 筆。
    // 白名單的代價是「將來新增的狀態會被擋掉」，所以下面把擋掉的狀態逐一列出來，
    // 不認得的狀態會出現在報告裡，不會安靜消失。
    const st = get(r, "orderStatus").toUpperCase();
    if (st !== "GO") {
      skippedCancelled++;
      byStatus.set(st || "(空白)", (byStatus.get(st || "(空白)") ?? 0) + 1);
      return;
    }

    const supplier = supplierCol >= 0 ? Number(clean(r[supplierCol])) : NaN;
    if (Number.isFinite(supplier)) suppliers.add(supplier);
    // 多日遊：AM 會自己寄名單，機器人寄了導遊就會收到兩份
    if (supplier === MULTI_DAY_SUPPLIER) {
      const k = get(r, "productNo");
      multiDay.set(k, (multiDay.get(k) ?? 0) + 1);
      return;
    }

    travelers.push({
      ...EMPTY,
      bookingNo: get(r, "bookingNo"),
      orderStatus: get(r, "orderStatus"),
      departureDate,
      bookingDate: normalizeBookingDate(get(r, "bookingDate")),   // 已是 JST，下游不可再轉
      productNo: get(r, "productNo"),
      productName: get(r, "productName"),
      packageName: get(r, "packageName"),
      buyerPhone: fixPhone(get(r, "buyerPhone")),
      tourLanguage: get(r, "tourLanguage"),
      note: get(r, "note"),
      enLastName: upper(get(r, "enLastName")),
      enFirstName: upper(get(r, "enFirstName")),
      gender: get(r, "gender"),
      birthday: normalizeBirthday(get(r, "birthday")),
      nationality: get(r, "nationality"),
      messenger: normalizeMessenger(get(r, "messenger")),
      rowNo: n + 2,
      // 回填 SCM 前要用它切供應商（見 scm-report.Traveler.supplierOid）
      supplierOid: Number.isFinite(supplier) ? supplier : undefined,
      specs: specCols.map((c) => (c >= 0 ? clean(r[c]) : "")).filter(Boolean),
    });
  });

  /**
   * **來源現在放的是未來一個月**（Ina 2026-08-18 改的），所以「混了別天的資料」
   * 是正常的，不再是異常。
   *
   * ⚠️ 換掉的同時也失去一個保護：原本靠「資料是不是只有明天」來判斷 Connected Sheet
   * 有沒有刷新——留著昨天的快照時，整批日期都會是昨天，一眼看得出來。
   * 一個月的窗口裡就算是昨天的快照也照樣有明天的資料，看不出差別，
   * 而漏掉的是**今天新進的訂單**。
   * → 刷新檢查改看那張表在 Drive 上的最後修改時間，見 scripts/wait-dap.ts。
   *
   * 這裡只留一個判斷：**整張表一列都沒有**才是壞掉。
   * 「這天沒有團」與「這天的團都是多日遊」都是正常情況，交給呼叫端照常報 0 台車。
   */
  if (travelers.length === 0 && wrongDate.length === 0 && multiDay.size === 0) {
    throw new Error(`DAP 名單有標題但沒有任何資料列 → 中止，請人工確認 ${expectedDate} 是否真的沒有團`);
  }


  return {
    travelers, skippedCancelled, missingColumns,
    skippedByStatus: [...byStatus].map(([status, rows]) => ({ status, rows })).sort((a, b) => b.rows - a.rows),
    skippedMultiDay: [...multiDay].map(([productNo, travelers]) => ({ productNo, travelers })),
    suppliers: [...suppliers].sort((a, b) => a - b),
  };
}
