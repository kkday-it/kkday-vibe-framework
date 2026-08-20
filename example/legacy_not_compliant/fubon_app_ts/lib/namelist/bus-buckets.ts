/**
 * 分車依據（A 團 / B 團）從大表讀出來。
 *
 * 大表每個商品分頁裡，**一列＝一台車**：
 *   團號 KK260802-284399A ｜ 出發日 ｜ 合計人數 ｜ 巴士公司車型「北之旅49座大巴 位空44」
 * 車別碼＝團號結尾那個英文字母（沒有字母＝只有一台車）。
 * 容量取自車型欄文字裡的「位空 44」；沒寫位空就退而求其次抓「49座」。
 *
 * ⚠️ 位空是打在車型欄的自由文字，不是獨立欄位 → 解析一定要寬鬆，
 *    抓不到就回 null 讓上層 fallback（絕不亂猜容量，寧可不分車）。
 */
import { parseBigDriver, hasBigDriver, type BigDriver } from "./big-driver.ts";

/** 團號：KKYYMMDD-商品編號[車別碼]。與 Portal 端同一套規則。 */
/**
 * 團號：KK + 出團日 + '-' + 商品編號 + 選填車別碼。
 * 實際大表上有三種合理變體（都是人手寫出來的，不該逼人改）：
 *   KK260802-284399A      標準（日期 6 碼）
 *   KK20250426-265887A    日期 8 碼
 *   KK241116-195654-A     車別碼前面有橫槓
 * 另外儲存格常有換行接其他說明 → 只看第一行。
 * ⚠️ Portal 端仍只收標準格式（新資料要乾淨）；這裡寬鬆是為了讀既有大表。
 */
export const TOUR_RE = /^KK(\d{6}|\d{8})-(\d{3,8})-?([A-Za-z])?$/;

export type BusBucket = {
  tourCode: string;      // KK260802-284399A
  carLetter: string;     // "A"／""（單車）
  date: string;          // 2026-08-02
  productNo: string;     // 284399
  capacity: number | null;   // 位空；抓不到＝null
  booked: number | null;     // 大表上寫的合計人數（拿來對帳，不是分車依據）
  busText: string;       // 原始車型文字，出錯時給人看
  /** 大表導遊欄原文（很雜：「林科豐 (Nick.yo.lin) 070-4034-4412 競技場スタンド：C區…」）。 */
  guideText: string;
  /** 從導遊欄拆出來的姓名與電話；拆不出就空字串，不猜。 */
  guideName: string;
  guidePhone: string;
  /** 大表司機欄原文。 */
  driverText: string;
  /**
   * 催行狀態，來自**團號欄左邊那一格**（實測就是 A 欄）：
   * 催行決定／不催行／催行待ち／募集中。Ina 2026-08-07 指出的。
   * 這比「每日總表確認」可靠——那張表只有 明天／+4／+7／+14 四格，D-2 查不到；
   * 這裡是一天一列，任何日期都問得到。讀不到就空字串，不猜。
   */
  status: string;
  /** true＝催行決定。只有這個值才算確定出團，「催行待ち」「募集中」都還沒定案。 */
  go: boolean;
  /**
   * 這個商品要不要用車。**分頁沒有「巴士公司 車型」欄＝不用車**
   * （例 30651 嵐山小火車，走鐵道＋遊船，沒有巴士，Ina 2026-08-06）。
   * 不用車的團自然沒有位空、也不需要分 A/B 車 → 位空空白不是缺失。
   */
  usesVehicle: boolean;
  /**
   * 大表上已經有的車號／司機／電話（過渡期 AM 問到就直接回填大表，不一定走 Portal）。
   * 沒有就三個欄位都是空字串。來源可能是導遊欄或司機欄——AM 寫在哪邊都認。
   */
  bigDriver: BigDriver;
  /**
   * 服務方式。**大表導遊欄空白＝這團是「司兼導」**（Ina 2026-08-06）：
   * 沒有另外派我方導遊，開車的人同時帶團 → 名單要寄給司兼導本人，
   * 而且對客的 LINE QR 是司機本人的（不是我方導遊的）。
   * 導遊欄有名字＝純司機團（我方另派導遊）。
   *
   * ⚠️ 例外（2026-08-15）：過渡期 AM 會把「車番／乗務員／連絡先」直接填進**導遊欄**
   *    （39100 積丹就是）。那是司機資訊，不是我方導遊 → 仍然算司兼導。
   *    沒擋的話這種團會被判成純司機，名單就寄錯人。
   */
  serviceMode: "司兼導" | "純司機";
  rowNo: number;
};

/** 導遊欄開頭通常就是姓名（中日文 2~5 字），後面才接英文暱稱／電話／集合點。 */
const GUIDE_NAME_RE = /^[\s]*([\u4e00-\u9fff\u3040-\u30ff]{2,5}(?:[　\s][\u4e00-\u9fff\u3040-\u30ff]{1,5})?)/;
/** 日本手機：070/080/090 開頭，中間可有橫槓或空白。 */
const GUIDE_PHONE_RE = /(0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,4})/;

export function parseGuide(text: string): { name: string; phone: string } {
  const t = String(text ?? "").replace(/\n/g, " ").trim();
  return {
    name: (GUIDE_NAME_RE.exec(t)?.[1] ?? "").replace(/[　\s]+/g, ""),
    phone: (GUIDE_PHONE_RE.exec(t)?.[1] ?? "").replace(/[-\s]/g, ""),
  };
}

const CAP_RE = /位空\s*[:：]?\s*(\d{1,3})/;      // 「位空44」「位空 44」「位空:44」
const SEAT_RE = /(\d{1,3})\s*(?:座|人座|席)/;    // 「49座」「14人座」

export function parseCapacity(busText: string): number | null {
  const t = String(busText ?? "").replace(/\n/g, " ");
  const cap = CAP_RE.exec(t);
  if (cap) return Number(cap[1]);
  const seat = SEAT_RE.exec(t);
  // 座位數是「車有幾個位子」，不等於可賣位（要扣導遊、司機）→ 標記後由上層決定
  return seat ? Number(seat[1]) : null;
}

export function parseTourCode(v: string) {
  const first = String(v ?? "").split(/[\n\r]/)[0].trim().toUpperCase().replace(/\s+/g, "");
  const m = TOUR_RE.exec(first);
  if (!m) return null;
  // 日期 8 碼是西元年寫全（20250426）→ 取後 6 碼統一
  const ymd = m[1].length === 8 ? m[1].slice(2) : m[1];
  return {
    code: m[0],
    productNo: m[2],
    carLetter: m[3] ?? "",
    date: `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`,
  };
}

/**
 * 從一個商品分頁的資料列，挑出指定出發日的所有車。
 * cols＝該分頁的欄位索引（由呼叫端用標題文字找出來，不寫死欄號）。
 */
export function findBuckets(
  rows: string[][],
  cols: { tour: number; bus: number; total: number | null; guide?: number; driver?: number },
  departureDate: string,
  headerRowIdx: number,
): BusBucket[] {
  const out: BusBucket[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const t = parseTourCode(r[cols.tour] ?? "");
    if (!t || t.date !== departureDate) continue;
    const busText = String(r[cols.bus] ?? "").trim();
    const totalRaw = cols.total != null ? String(r[cols.total] ?? "").trim() : "";
    const guideText = cols.guide != null && cols.guide >= 0 ? String(r[cols.guide] ?? "").trim() : "";
    const g = parseGuide(guideText);
    const driverText = cols.driver != null && cols.driver >= 0 ? String(r[cols.driver] ?? "").trim() : "";
    const usesVehicle = cols.bus >= 0;
    /**
     * 狀態格**不寫死欄號**，從團號欄往兩邊找第一個看起來像狀態的格子。
     *
     * 🔴 原本只往左找。「268173 九州包車」那張的團號在 A 欄、催行狀況在 **B 欄**，
     * 於是狀態永遠讀成空字串 → `go` 是 false → **D-2 體檢直接把那團排除掉**，
     * 而名單那支照樣會寄。也就是說 8/24 的九州包車團從來沒被體檢過，
     * 而畫面上只寫「排除 8 團」，沒有人看得出少了誰（2026-08-18 發現）。
     *
     * 先左後右：左邊是多數分頁的慣例，維持原本的優先順序。
     */
    const STATUS_RE = /催行決定|不催行|催行待ち|催行待|募集中|中止|取消/;
    const scan = (from: number, to: number, step: number) => {
      for (let c = from; step > 0 ? c <= to : c >= to; c += step) {
        const v = String(r[c] ?? "").trim();
        if (STATUS_RE.test(v)) return v;
      }
      return "";
    };
    const status = scan(cols.tour - 1, 0, -1) || scan(cols.tour + 1, r.length - 1, 1);
    // 車號／司機資訊可能被填在導遊欄或司機欄，兩邊都看；導遊欄那份優先（AM 實際填的位置）
    const fromGuide = parseBigDriver(guideText);
    const bigDriver = hasBigDriver(fromGuide) ? fromGuide : parseBigDriver(driverText);
    // 導遊欄裝的是司機資訊區塊 → 那不是我方導遊，這團仍是司兼導
    const guideIsDriverBlock = hasBigDriver(fromGuide);
    const serviceMode: "司兼導" | "純司機" = guideText && !guideIsDriverBlock ? "純司機" : "司兼導";
    out.push({
      tourCode: t.code, carLetter: t.carLetter, date: t.date, productNo: t.productNo,
      capacity: parseCapacity(busText),
      booked: /^\d+$/.test(totalRaw) ? Number(totalRaw) : null,
      busText, guideText,
      guideName: guideIsDriverBlock ? "" : g.name,
      guidePhone: guideIsDriverBlock ? "" : g.phone,
      bigDriver,
      status, go: /催行決定/.test(status) && !/不催行/.test(status),
      driverText, serviceMode, usesVehicle, rowNo: i + 1,
    });
  }
  return out.sort((a, b) => a.carLetter.localeCompare(b.carLetter));
}

/**
 * 這台車不會出。兩個訊號：
 *   ① 狀態欄明講不催行／中止／取消
 *   ② 車型欄被 OP 拿來寫「無單關團」「不成團已關團 請挪08/22」這類註記
 *
 * ⚠️ 要**逐台車**看，不能整個商品一起判——同一商品可能 A 車照出、C 車已關
 * （528834 8/10 就是）。體檢一直是這樣判的，名單包沒跟上，於是照樣產出一台
 * 0 人的空車、還去催司機（Ina 2026-08-17 指出）。這個判斷放在這裡當唯一實作。
 */
export const CLOSED_NOTE = /關團|不成團|無單|取消|中止|不催行/;
export function isDeadBucket(b: Pick<BusBucket, "busText" | "status">): boolean {
  return CLOSED_NOTE.test(String(b.busText ?? "")) || /不催行|中止|取消/.test(String(b.status ?? ""));
}
