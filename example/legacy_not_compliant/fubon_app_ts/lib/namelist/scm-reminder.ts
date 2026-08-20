/**
 * 組出 SCM「更新行前提醒」要送的 payload。
 *
 * 端點：
 *   POST /api/v1/{lang}/order/update_pre_trip_reminder
 *
 * ⚠️ **這支只組資料、不送出。** 送出＝SCM 會立刻發通知與信件給旅客，
 * 所以送出那一步要有人按，不放在自動流程裡。
 *
 * 2026-08-17 stage 修好了（RD），讀寫都通 → 之後**先在 stage 驗**，不要拿正式台當試驗場。
 * 2026-08-16 在**正式台**實送驗證過：
 * 成功回應是 `200` ＋ `{"result":true,"data":{"result_code":"0000"}}`——
 * **只看 HTTP 200 不夠，要看 result_code。**
 * `tourGuidePersonOid` 給 `null`＋純文字 `name` **第一次**存得進去（不必先把車公司司機建進 SCM），
 * 但 🔴 **第二次開始就不行**（2026-08-17 stage 實測）：SCM 存檔時會自己配一個 oid，
 * 之後對同一張訂單再送 `null`，**回 `0000`、實際什麼都沒改**——安靜地沒生效，最難查的那種。
 * 所以寫之前一定要先讀，把現有的 `tourGuidePersonOid` 原樣帶回（見 existingGuideOid）。
 * 這件事對「事後換司機」是致命的：AM 改了人，程式回報成功，客人看到的還是舊的那個。
 *
 * 幾個從實測得到、影響組法的事實：
 *  - `identity` 只有 DRIVER／TOUR_GUIDE，**沒有司兼導**：
 *      純司機團 → TOUR_GUIDE（車公司出司機，我方另派導遊，填的是那位導遊）
 *      司兼導團 → DRIVER（Ina 2026-08-13 決定：這個人本質上是司機，客人看到「司機」較貼實際）
 *  - `driverGuide` 是單一物件 → 一筆訂單只放一個人
 *  - 電話留空也送得出去 → 車公司只給車號時可以先寫進去，不必等資料到齊
 *  - `orderMid` 是單數字串 → **一筆訂單一次請求，沒有批次**（2026-08-17 stage 試過：
 *    給陣列回 `Server Error`、給逗號分隔回「訂單資料不存在」）。9 台車就是 9 次請求。
 *
 * 2026-08-14 改版（Ina）：**不再送罐頭訊息，也不再上傳 QR 圖**；
 * 而且**純司機團只送導遊姓名、電話、通訊軟體，不送車牌**——名單上有什麼就送什麼。
 * 客人要加司導的 LINE，改成在導遊名單維護一條「Line 連結」（加好友網址），
 * 回填時身份選 LINE、帳號直接放那條連結——客人點一下就加到，不用存圖再掃。
 * 因此 `otherReminder` 一律 null：罐頭文原本是用來補充聯絡方式的，現在沒有要補充的東西，
 * 送一段沒有新資訊的文字只會佔版面。
 */
import { type Scenario } from "./reminder-templates.ts";

export const REMINDER_PATH = "/api/v1/zh-tw/order/update_pre_trip_reminder";

/**
 * 讀現有的行前提醒。**寫之前一定要先讀**——payload 是整包送的，
 * 沒讀就寫等於拿預設值覆蓋掉別人（或前台）已經填好的東西，`meetUp` 尤其致命。
 *   GET /api/v1/zh-tw/order/pre_trip_reminder?orderMid=…
 */
export const REMINDER_READ_PATH = "/api/v1/zh-tw/order/pre_trip_reminder";

/**
 * SCM 的身份代碼。司兼導沒有專屬代碼，見檔頭說明。
 * ⚠️ 導遊是 **TOUR_GUIDE**，不是 `GUIDE`——2026-08-16 從正式台實送的請求裡看到的。
 *    8/13 憑猜寫成 `GUIDE`，而錯的代碼**不會噴錯**，只會靜靜地存不進去。
 */
export type Identity = "DRIVER" | "TOUR_GUIDE";

export type ScmIm = { extraContactOid: null; platform: string; id: string };

export type ScmReminderPayload = {
  orderMid: string;
  /**
   * 🔴 **不送 meetUp 這個 key**（2026-08-17 stage 實測改的做法）。
   *
   * 原本是「讀出來原樣帶回」。實測發現更好的做法是**整個欄位不要出現在 payload 裡**：
   *   - 對有集合地點的 26KK219334778 送不含 meetUp 的 payload → 存檔成功，
   *     集合地點 1178 字**完全沒動**（不是「一樣」，是根本沒被碰）。
   *   - 帶著 meetUp 送，SCM 內部會先打
   *     `POST api/v2/order/meetingPoint/delete/{orderMid}` 把集合地點刪掉再重建——
   *     多繞一圈刪除，而且刪掉重建之間任何失敗都會讓客人的集合地點消失。
   *
   * 「原樣帶回」要對，前提是那次 GET 沒漏欄位；「不送」則不需要任何前提。
   * 少一個必須做對的步驟，就少一種出錯的方式。
   */
  meetUp?: undefined;
  driverGuide: {
    tourGuidePersonOid: number | null;
    identity: Identity;
    name: string;
    serviceLangs: string[];
    phone: { countryCode: string; number: string };
    ims: ScmIm[];
    vehicle: { plateNumber: string; color: string; model: string };
  };
  /** 空字串，不是 null——SCM 前台送的就是 `""`（2026-08-16 實測）。 */
  otherReminder: string;
};

/** 我們這邊收到的一團的人與車。 */
export type ReminderInput = {
  orderMid: string;
  scenario: Scenario;
  /** 純司機＝我方導遊姓名；司兼導＝司機姓名 */
  name: string;
  /** 電話拆成國碼與號碼，跟 SCM 的欄位一致 */
  phoneCountryCode?: string;
  phoneNumber?: string;
  imType?: string;
  imAccount?: string;
  /**
   * 其他通訊軟體（Ina 2026-08-13）：導遊清單上若有 WeChat／WhatsApp，也要一起送進 SCM。
   * 客人不一定用 LINE——只給 LINE 等於部分客人聯絡不到人。SCM 的 ims 是陣列，放得下多個。
   */
  contacts?: { type: string; account: string }[];
  plateNumber?: string;
  /** 訂單語系（zh-tw / zh-hk / en…），拿來當 serviceLangs */
  tourLanguage: string;
  /**
   * 🔴 這張訂單**現有的** `tourGuidePersonOid`（從 GET 讀出來原樣帶回）。
   *
   * 沒填過的訂單是 `null`／`undefined`，第一次寫給 null 就好；
   * **但只要 SCM 已經有一筆司導資料，就必須帶回它的 oid，否則更新會安靜地沒生效**
   * （回 0000、資料不動）。見檔頭。
   */
  existingGuideOid?: number | null;
};

/**
 * 通訊軟體名稱 → SCM 的 platform 代碼。認不得的原樣送上去，不亂猜。
 * LINE／WHATSAPP／WECHAT 三個代碼 2026-08-16 各在正式台前台存過一次，確認無誤。
 */
const PLATFORM: Record<string, string> = {
  line: "LINE", LINE: "LINE", whatsapp: "WHATSAPP", wechat: "WECHAT", kakaotalk: "KAKAOTALK",
};
const platformOf = (v: string) => PLATFORM[(v ?? "").trim()] ?? PLATFORM[(v ?? "").trim().toLowerCase()] ?? (v ?? "").trim();

/**
 * 客人這一側「該有卻沒有」的欄位。
 * 司兼導要給客人的是：**司機身份＋電話＋車牌**（Ina 2026-08-13）——
 * 客人要打得到人、也要認得出哪一台車。缺了照送（有總比沒有好），但要講出來讓人去補。
 */
export function missingForCustomer(input: ReminderInput): string[] {
  const miss: string[] = [];
  if (!(input.phoneNumber ?? "").trim()) miss.push("電話");
  // 車牌只有司兼導要——純司機團客人見到的是我方導遊，不需要認車（Ina 2026-08-14）
  if (input.scenario === "司兼導" && !(input.plateNumber ?? "").trim()) miss.push("車牌");
  return miss;
}

/**
 * 🔴 已解（2026-08-17 stage 實測）：**payload 裡不要有 meetUp 這個 key。**
 *
 * 三種送法都試過：
 *   帶原值回去 → 成功，但 SCM 內部會先刪集合地點再重建
 *   `meetUp: null` → 成功，等於把它清掉
 *   **整個 key 不送** → 成功，集合地點連碰都沒被碰（1178 字的那張前後完全相同）
 *
 * 這支現在只負責擋一件事：不小心又把 meetUp 塞進 payload。
 */
export function assertNoMeetUp(payload: object, orderMid: string): void {
  if (Object.prototype.hasOwnProperty.call(payload, "meetUp")) {
    throw new Error(`${orderMid}：payload 不該有 meetUp（送了 SCM 會刪掉集合地點再重建）`);
  }
}

export function buildScmReminder(input: ReminderInput): ScmReminderPayload {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error(`${input.orderMid}：沒有姓名 → 不組 payload（客人會看到空白的司導資訊）`);

  // 主要帳號（多半是 LINE）＋導遊清單上的其他軟體，一起送。
  // 同一個 platform 只留第一個：SCM 會逐筆顯示給客人，重複會讓人以為要加兩次。
  const all = [
    { type: input.imType ?? "LINE", account: input.imAccount ?? "" },
    ...(input.contacts ?? []),
  ];
  const ims: ScmIm[] = [];
  for (const c of all) {
    const id = (c.account ?? "").trim();
    if (!id) continue;
    const platform = platformOf(c.type || "LINE");
    if (ims.some((x) => x.platform === platform)) continue;
    ims.push({ extraContactOid: null, platform, id });
  }

  return {
    orderMid: input.orderMid,
    // 沒有 meetUp 這個 key——見 assertNoMeetUp。
    driverGuide: {
      // 已經有司導資料的訂單必須帶回原 oid，不然更新會安靜地沒生效（見檔頭）
      tourGuidePersonOid: input.existingGuideOid ?? null,
      // SCM 沒有司兼導這個身份 → 司兼導選「司機」，純司機團填的是我方導遊（見檔頭）
      identity: input.scenario === "司兼導" ? "DRIVER" : "TOUR_GUIDE",
      name,
      // 導覽語言就是這團的服務語言；SCM 收的是陣列
      serviceLangs: [(input.tourLanguage ?? "").trim() || "zh-tw"],
      phone: {
        countryCode: (input.phoneCountryCode ?? "").replace(/\D/g, ""),
        number: (input.phoneNumber ?? "").trim(),
      },
      ims,
      // 車牌收日文格式（`品川300あ12-34` 2026-08-16 實測存得進去），color／model 空著也不擋。
      // 純司機團**不填車牌**（Ina 2026-08-14）：客人跟著我方導遊走，
      // 給車牌只是多一個要維護、又可能臨時換車而失準的欄位。
      vehicle: {
        plateNumber: input.scenario === "司兼導" ? (input.plateNumber ?? "").trim() : "",
        color: "", model: "",
      },
    },
    // 不送罐頭文（見檔頭）：姓名／電話／車牌／LINE 連結都是結構化欄位，SCM 自己會顯示。
    // 空值慣例照正式台：字串欄位一律 ""。
    otherReminder: "",
  };
}


/**
 * GET 回來的東西**不能整包送回去**（2026-08-17 讀正式台 26KK219334778 確認）。
 *
 * 回應裡混著兩種東西：
 *   ① 這張訂單的內容 —— preTripStatus / meetUp / driverGuide / otherReminder
 *   ② 給畫面用的參考資料 —— guideLangList（15 筆語言）、telCodes（246 筆國碼）、result_code
 *
 * ② 那些不是訂單的一部分，原封送回去等於把一堆無關資料塞進這張單。
 * 這支只挑得出 ① ——**新增欄位時要人明確加進來**，寧可漏送也不要糊裡糊塗多送。
 */
export type ExistingReminder = {
  preTripStatus?: unknown;
  meetUp?: unknown;
  driverGuide?: unknown;
  otherReminder?: unknown;
};

export function pickWritable(getResponse: unknown): ExistingReminder {
  const d = (getResponse as any)?.data ?? getResponse ?? {};
  const out: ExistingReminder = {};
  for (const k of ["preTripStatus", "meetUp", "driverGuide", "otherReminder"] as const) {
    if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
  }
  return out;
}
