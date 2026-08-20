/**
 * 從 SCM 名單產出「給導遊的名單」。
 *
 * 目標格式＝Ina 提供的真實樣板（sheet 1QAZdhyHTQ2k…「0801」）：
 *   一天一份、一商品/團一分頁；抬頭＝商品名；一旅客一列；結尾＝總人數＋導遊姓名＋電話。
 *   欄＝訂單編號／訂單日期／訂單語系／旅客英文姓名／產品編號／套餐名／性別／生日／年齡／
 *       國籍／訂購人電話／App Type／App Account／訂單備註
 *   ⚠️ 不放身分證／護照號（隱私，只到生日與年齡）。
 *
 * 其他規則：
 *  - 只取目標出發日：匯出檔可能含其他日期的訂單（實測 7/24 下載的檔裡是 6/20 出發）。
 *  - 備註如實帶（分車與特殊需求靠它），但**簡體轉繁體**（車公司與部分客人填簡體）。
 *  - 依備註分車：備註出現「X台車／分車／另一台」等字樣時標記，需人工確認，不自動拆。
 */
import { ageOn, parseCustomersReport, splitMessenger, type Traveler } from "./scm-report.ts";


/** 語系代碼 → 名單上寫的全稱（照 SCM 自己的語言名稱）。 */
const LOCALE_NAME: Record<string, string> = {
  "zh-tw": "繁體中文(台灣)", "zh-hk": "繁體中文(香港)", "zh-cn": "简体中文",
  en: "English", ja: "日本語", ko: "한국어", th: "ไทย", vi: "Tiếng Việt",
};
const localeName = (v: string) => LOCALE_NAME[(v ?? "").trim().toLowerCase()] ?? (v ?? "").trim();

/** 性別 M/F → 男/女（名單樣板寫中文）。 */
const genderZh = (v: string) => ({ M: "男", F: "女", m: "男", f: "女" }[(v ?? "").trim()] ?? (v ?? "").trim());

/** 「名 姓」順序：樣板是 YU-TANG HSIEH（名在前），SCM 匯出是分開兩欄。 */
const enNameOrder = (first: string, last: string) => [first, last].filter(Boolean).join(" ").trim();

/** 電話：SCM 給「+886 915831993」，名單樣板用「+886-915831993」。 */
const dashPhone = (v: string) => (v ?? "").trim().replace(/^(\+\d{1,4})\s+/, "$1-");

/** SCM 匯出的訂購日是 GMT+9，名單樣板寫 GMT+8 → 減一小時。 */
export function toGmt8(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec((v ?? "").trim());
  if (!m) return (v ?? "").replace(/\s*\(GMT.*\)$/, "");
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 3600_000; // +9 → +8
  const t = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** 簡→繁（只收常見字，逐步補；查不到就原樣保留，不亂猜）。 */
const S2T: Record<string, string> = {
  们: "們", 儿: "兒", 个: "個", 么: "麼", 为: "為", 乐: "樂", 书: "書", 买: "買", 从: "從",
  会: "會", 传: "傳", 伟: "偉", 体: "體", 众: "眾", 优: "優", 儿童: "兒童", 关: "關", 兴: "興",
  内: "內", 写: "寫", 军: "軍", 农: "農", 决: "決", 处: "處", 备: "備", 复: "複", 头: "頭",
  learn: "learn", 学: "學", 实: "實", 宝: "寶", 对: "對", 导: "導", 岁: "歲", 师: "師",
  带: "帶", 张: "張", 强: "強", 归: "歸", 当: "當", 应: "應", 总: "總", 恋: "戀", 户: "戶",
  报: "報", 拉: "拉", 换: "換", 据: "據", 无: "無", 时: "時", 显: "顯", 术: "術", 机: "機",
  杂: "雜", 条: "條", 来: "來", 极: "極", 构: "構", 样: "樣", 标: "標", 树: "樹", 桥: "橋",
  检: "檢", 汉: "漢", 没: "沒", 泽: "澤", 济: "濟", 点: "點", 为什么: "為什麼", 环: "環",
  现: "現", 电: "電", 画: "畫", 发: "發", 简: "簡", 类: "類", 结: "結", 给: "給", 统: "統",
  继: "繼", 绍: "紹", 经: "經", 缺: "缺", 网: "網", 罗: "羅", 声: "聲", 处理: "處理",
  职: "職", 联: "聯", 号: "號", 观: "觀", 认: "認", 让: "讓", 记: "記", 讲: "講", 请: "請",
  说: "說", 语: "語", 车: "車", 转: "轉", 边: "邊", 达: "達", 过: "過", 运: "運", 还: "還",
  这: "這", 进: "進", 远: "遠", 连: "連", 选: "選", 长: "長", 门: "門", 问: "問", 间: "間",
  队: "隊", 阳: "陽", 际: "際", 页: "頁", 顾: "顧", 风: "風", 飞: "飛", 馆: "館", 验: "驗",
  体验: "體驗", 岁小孩: "歲小孩", 婴: "嬰", 儿座: "兒座", 座椅: "座椅", 台车: "台車",
  单: "單", 双: "雙", 岁儿童: "歲兒童", 孩: "孩", 妈: "媽", 爸: "爸", 车位: "車位",
};
export function toTraditional(s: string): string {
  return [...(s ?? "")].map((c) => S2T[c] ?? c).join("");
}

/**
 * 規格值裡**真正該讓導遊看到的**那些。
 *
 * DAP 的規格欄大多只是票種（成人／兒童／幼童／不拘），那對導遊沒有用：
 * 名單上每個人都有年齡，而且規格是**訂單層**的（同一張單每列都一樣，實測 377 張單
 * 沒有一張的規格逐人不同），所以「成人、兒童」只說得出這張單有大人也有小孩，
 * 看不出哪一位是小孩。印出來只是噪音（Ina 2026-08-18 決定不印）。
 *
 * 真正有用的是**客人選的那個東西**——包車商品（196022／265887／170052／268173）
 * 的路線就在規格欄裡，同一個方案名稱底下路線完全不同：
 *   「富士山一日遊～冰穴風穴＋新倉山淺間公園」vs「箱根一日遊」
 * 而方案名稱只寫得出「【6人成行｜專屬包車】」這種成團人數，看不出今天要去哪。
 *
 * ⚠️ **認不得的值一律留著**。漏印一個客人選過的東西，導遊到現場才發現；
 *    多印一行只是佔位子。所以這裡是黑名單（濾掉票種），不是白名單。
 */
/**
 * 包車型商品（Ina 2026-08-18）。**一張訂單＝一台車**，大表上一個團號對一個訂單編號。
 *
 * 這幾個商品的方案名稱只寫得出成團人數（「【6人成行｜專屬包車】…任選案」），
 * 客人真正選的路線在規格欄裡 → 名單與信件都要印規格。
 * 募集型的團剛好相反：規格只是票種，信件不需要（見 guide-mail 的用法）。
 */
export const CHARTER_PRODUCTS = new Set(["196022", "265887", "170052", "268173"]);

/**
 * 是不是包車。**兩個來源一起看**（Ina 2026-08-18 問「要不要 AM 維護一張清單」）：
 *
 *   ① 已知的商品編號清單（上面那個 Set）
 *   ② 方案名稱裡有沒有「包車／チャーター」
 *
 * 為什麼不只用清單：新開一個包車商品時，**沒有人會記得來跟我說**，
 * 而漏掉的後果是導遊那封信少了「當天路線」——他到現場才發現要走哪條。
 * 為什麼不只看方案名：命名是行銷寫的，哪天寫成「專車」就整個失效。
 *
 * 兩個各自會漏，但**同時漏的機率低很多**；不一致時 charterMismatch() 會喊出來，
 * 由人決定要把編號加進清單、還是那個方案名根本是誤植。
 * → 所以既不用 AM 維護一張清單，也不用每次新增商品都來跟我說。
 */
export function isCharter(productNo: string, packageName = ""): boolean {
  return CHARTER_PRODUCTS.has(String(productNo ?? "").trim())
    || /包車|包车|チャーター/.test(String(packageName ?? ""));
}

/** 兩個來源說法不一樣 → 回傳一句話說明，沒有不一致回空字串。 */
export function charterMismatch(productNo: string, packageNames: string[]): string {
  const listed = CHARTER_PRODUCTS.has(String(productNo ?? "").trim());
  const named = packageNames.some((n) => /包車|包车|チャーター/.test(String(n ?? "")));
  if (listed === named) return "";
  return listed
    ? `${productNo} 在包車清單裡，但方案名沒有「包車」→ 確認是不是改了商品型態`
    : `${productNo} 的方案名有「包車」，但不在包車清單裡 → 新的包車商品？名單會少印當天路線`;
}

/**
 * 包車商品的方案名稱**只留前面那個【】**（「6人成行｜專屬包車」）。
 *
 * 後面接的是「阿蘇中岳火山 & 熊本城 & …宇佐神宮任選案」——那是**可選清單**，
 * 跟商品名幾乎一字不差，而當天真正要走的那條在規格欄。三行長得一樣的字疊在一起，
 * 真正有差別的那行反而被擠掉（Ina 2026-08-18）。
 */
export function shortCharterPlan(name: string): string {
  const m = /^\s*【([^】]+)】/.exec(String(name ?? ""));
  return m ? m[1].trim() : String(name ?? "").trim();
}

const TICKET_TYPE = /^(成人|大人|兒童|小孩|幼童|嬰兒|幼兒|長者|敬老|不拘|一般)$/;
export function meaningfulSpecs(specs: string[] | undefined): string[] {
  return (specs ?? [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    // 「成人、兒童」這種組合值也是票種 —— 拆開來每一段都是票種就整個丟掉
    .filter((x) => !x.split(/[、,，/／\s]+/).filter(Boolean).every((p) => TICKET_TYPE.test(p)));
}

/** 備註像是要分車？（不自動拆，只標記給人確認） */
const SPLIT_HINT = /(\d+\s*[台臺]\s*車|分車|另一[台臺]|不同車|同車|坐一起|同一[台臺])/;

export type NamelistRow = {
  bookingNo: string; bookingDate: string; language: string;
  /**
   * 語系**代碼**（zh-tw／ja／en…）。`language` 是給人看的全稱，這個是給機器用的。
   * 回填 SCM 的 serviceLangs 要的是代碼——原本沒帶下來，只好寫死 zh-tw，
   * 香港與英文團的客人就會看到錯的服務語言。
   */
  languageCode: string;
  enName: string; productNo: string; packageName: string;
  /** 供應商 OID。回填 SCM 前要用它切 context（見 scm-report.Traveler.supplierOid）。 */
  supplierOid?: number;
  /** 規格值（規格1／2／3 有填的那些）。 */
  specs?: string[];
  gender: string; birthday: string; age: number; nationality: string;
  buyerPhone: string; appType: string; appAccount: string; note: string;
  splitHint: boolean;
};

export type ProductGroup = {
  productNo: string; productName: string; departureDate: string;
  rows: NamelistRow[]; total: number;
  /** 需要人工確認的事（年齡算不出、備註提到分車…）。 */
  warnings: string[];
};

export function buildNamelist(csvText: string, departureDate: string): {
  groups: ProductGroup[]; skippedOtherDates: number; missingFields: string[]; skippedCancelled: number;
} {
  const parsed = parseCustomersReport(csvText);
  const built = buildFromTravelers(parsed.travelers, departureDate, { bookingDateIsJst: false });
  return { ...built, missingFields: parsed.missingFields, skippedCancelled: parsed.skippedCancelled };
}

/**
 * 已經解析好的 Traveler → 名單。DAP 來源走這支。
 *
 * bookingDateIsJst：DAP 那份 Data Team 已經把訂購日轉成 JST 了，**再轉一次會早一小時**。
 * SCM 匯出的那份才是 GMT+9 原始值，需要轉。
 */
export function buildFromTravelers(
  travelers: Traveler[], departureDate: string, opts: { bookingDateIsJst: boolean },
): { groups: ProductGroup[]; skippedOtherDates: number } {
  const byProduct = new Map<string, Traveler[]>();
  let skippedOtherDates = 0;

  for (const t of travelers) {
    if (t.departureDate.slice(0, 10) !== departureDate) { skippedOtherDates++; continue; }
    const k = t.productNo || "（無商品編號）";
    (byProduct.get(k) ?? byProduct.set(k, []).get(k)!).push(t);
  }

  const groups: ProductGroup[] = [];
  for (const [productNo, list] of byProduct) {
    const warnings: string[] = [];
    const rows = list.map((t) => {
      const age = ageOn(t.birthday, t.departureDate);
      const { type, account } = splitMessenger(t.messenger);
      const note = toTraditional(t.note);
      if (age < 0 && t.birthday) warnings.push(`${t.bookingNo}：生日「${t.birthday}」算不出年齡`);
      if (!t.birthday) warnings.push(`${t.bookingNo}：沒有生日 → 年齡空白（保險分桶也會受影響）`);
      const enName = enNameOrder(t.enFirstName, t.enLastName);
      if (!enName) warnings.push(`${t.bookingNo}：沒有英文姓名，只有中文「${t.localLastName}${t.localFirstName}」`);
      // 代碼沒對到軟體名稱 → 名單上會印「0003（軟體待確認）」，這裡也要出警告讓人去問 Data team
      if (/^\d{4}$/.test(type)) warnings.push(`${t.bookingNo}：APP 聯絡方式代碼「${type}」不在對照表 → 不知道是哪個通訊軟體`);
      if (note && SPLIT_HINT.test(note)) warnings.push(`${t.bookingNo}：備註提到分車／同車「${note.slice(0, 40)}」→ 請人工確認分車`);
      return {
        bookingNo: t.bookingNo,
        bookingDate: opts.bookingDateIsJst ? t.bookingDate.replace("T", " ").slice(0, 16) : toGmt8(t.bookingDate),
        language: localeName(t.tourLanguage), languageCode: (t.tourLanguage ?? "").trim().toLowerCase(), enName, productNo: t.productNo,
        packageName: toTraditional(t.packageName), gender: genderZh(t.gender),
        birthday: t.birthday, age, nationality: t.nationality,
        buyerPhone: dashPhone(t.buyerPhone), appType: type, appAccount: account, note,
        splitHint: !!note && SPLIT_HINT.test(note),
        supplierOid: t.supplierOid,
        specs: t.specs ?? [],
      } satisfies NamelistRow;
    });
    groups.push({
      productNo, productName: list[0].productName, departureDate,
      rows, total: rows.length, warnings: [...new Set(warnings)],
    });
  }

  groups.sort((a, b) => a.productNo.localeCompare(b.productNo));
  return { groups, skippedOtherDates };
}

export const NAMELIST_HEADER = [
  "訂單編號(mid)", "訂單日期(GMT+8)", "訂單語系", "旅客姓名", "產品編號", "套餐名稱(zh-tw)",
  "性別", "生日", "年齡", "國籍", "訂購人電話", "App Type", "App Account", "訂單備註",
];

export const toSheetRow = (r: NamelistRow): string[] => [
  r.bookingNo, r.bookingDate, r.language, r.enName, r.productNo, r.packageName,
  r.gender, r.birthday, r.age >= 0 ? String(r.age) : "", r.nationality,
  r.buyerPhone, r.appType, r.appAccount, r.note,
];
