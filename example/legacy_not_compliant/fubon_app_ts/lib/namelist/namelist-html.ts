/**
 * 導遊名單版型（HTML → PDF）。對齊現行給導遊的 Google Sheet 樣板
 * （抬頭＝商品名＋出發日＋團號；一旅客一列；結尾＝總人數＋導遊姓名電話）。
 *
 * 版型要求（導遊在車上用手機／紙本看）：
 *  - A4 直式、字夠大、隔列底色，掃視得快
 *  - 備註欄最寬 —— 那是導遊真正會讀的欄
 *  - 同行群組標同一個記號（①②③），導遊排座位一眼看得出誰要坐一起
 *  - 不放身分證／護照號（隱私）
 */
import { foldHan } from "./han-fold.ts";
import { KKDAY_WORDMARK } from "./brand.ts";
import { prettyPhone } from "./phone.ts";import type { BusGroup } from "./enrich.ts";
import { meaningfulSpecs, isCharter, shortCharterPlan, type NamelistRow } from "./guide-namelist.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫";

export type NamelistDoc = {
  productNo: string; productName: string; departureDate: string;
  bus: BusGroup;
  /** 訂單編號 → 同行群組代號 */
  companions: Map<string, string>;
  guideName?: string; guidePhone?: string;
  /** 車公司從 Portal 回報的車輛與司機；沒回報就留空，版面照樣印出空欄讓導遊手寫 */
  /**
   * 這個行程用不用車。false＝沒有巴士（例 30651 嵐山走鐵道＋遊船，Ina 2026-08-15）→
   * **整塊車輛資訊不印**。印出來會變成三行「情報は本日中にご連絡」，
   * 對一個根本沒有車的行程來說是誤導，導遊會以為還在等車。
   */
  usesVehicle?: boolean;
  vehicle?: {
    company?: string; plate?: string;
    drivers?: { name: string; phone?: string; imType?: string; imAccount?: string }[];
  };
};

/**
 * 方案名稱：先判斷「**行程是不是真的不一樣**」，再決定要不要標給導遊看。
 *
 * 為什麼不能直接比字串（Ina 2026-08-17 問「要不要在 DAP 加 pkg oid」時查出來的）：
 * 實際資料裡同一個商品的多個方案，差別幾乎都在**成團人數與促銷標籤**，行程完全相同——
 *   155294：【1人成團】富田農場…／【早鳥限時特惠｜45%OFF】富田農場…【20人成團】／
 *           【早鳥限時特惠】富田農場…【20人成團】
 *   30651 ：【1人成團】嵐山半日遊…／【嵐山半日遊】…【6人成團】
 * 這些對導遊是同一件事。照字串比會標出 A／B／C 三個代號，只會讓人以為要分開帶。
 *
 * **pkg oid 也解決不了**：上面三個是三個不同的 oid，用 oid 比只會分得更細。
 * 要判斷的是「行程內容一不一樣」，不是「賣的是不是同一個 SKU」。
 *
 * ⚠️ 只剝**促銷與成團**這類確定與行程無關的字。「【方案A】【方案B】」這種
 *    真正的方案區別也寫在【】裡，整段剝掉會把該分的併成一個 —— 那比多標更危險。
 *
 * ⚠️ 也**不剝單獨的「限定」**：「【女性限定】」是真的方案差異，
 *    「期間限定」「暑假限定」「限量促銷」才是促銷。這條界線是拿實際資料校過的
 *    （2026-08-17 掃過去四天的名單快照時，528834 的「暑假限定」與 158778 的
 *      「限量促銷」原本沒被剝，同一個Ｃ方案被算成兩種）。
 */
/** 純促銷／成團字樣：整段只有這些東西時才丟掉。 */
const PROMO_ONLY = /^(?:\s*(?:\d+\s*人成團|成團|保證出發|保證出團|保證成行|保証出発|早鳥|限時|特惠|優惠|下殺|折扣|\d+\s*折|\d+\s*%\s*OFF|OFF|KKday獨家|獨家|加購|最後\d*組?|再加碼|促銷|限量|期間限定|季節限定|新品|人氣|熱賣|セール|特価|割引|キャンペーン|晚鳥|買一送一|買1送1|1\s*送\s*1|B1G1)\s*[｜|、,，~～!！]*)+$/i;
/** 「暑假限定～」「秋冬限定～」這種**前綴**：後面接的常是真正的差異（餐食內容）。 */
const SEASON_PREFIX = /^[^～~]{0,8}限定\s*[～~]\s*/;
/**
 * 促銷字樣也要認**簡體**（Ina 2026-08-19：8/20 的 155294 有一筆簡體下單）。
 * 與其把「成团」「优惠」逐個補進上面的表（總會漏），不如把整個 pattern 折成簡體，
 * 比對時兩邊都折——規則只寫一次，繁簡自動同步。
 */
const PROMO_ONLY_F = new RegExp(foldHan(PROMO_ONLY.source), "i");
const isPromoOnly = (seg: string) => PROMO_ONLY_F.test(foldHan(seg));

/**
 * 給人看的名稱：把【】裡**純促銷**的段落丟掉，其餘留下。
 *
 * ⚠️ **逐段判斷，不是整塊丟**（Ina 2026-08-17 給了 528834 的實際方案清單才發現）。
 * 「【1人成團｜保證出發｜暑假限定～日本水蜜桃吃到飽＋箱根釜飯御膳午餐！】」裡，
 * 前兩段是促銷、第三段的「日本水蜜桃吃到飽＋箱根釜飯御膳午餐」是**餐食**——
 * 那正是 C 方案與 D 方案（長腳蟹盛宴）的差別，也是導遊現場要知道的事。
 * 整塊丟掉的話，B／C／D 三個方案的說明會全變成「含「叢林巴士」搭乘費用」。
 *
 * 【】裡若整段都不是促銷（「【方案A】」「【太宰府天満宮行程】」）→ 拆掉括號留內容。
 */
export function displayPackage(name: string): string {
  const s0 = String(name ?? "").trim();
  const s1 = s0.replace(/【([^】]*)】/g, (_m, inner: string) => {
    const kept = String(inner).split(/[｜|]/)
      .map((seg) => seg.trim())
      .filter((seg) => seg && !isPromoOnly(seg))
      // 「暑假限定～日本水蜜桃…」→ 留下「日本水蜜桃…」；剝完只剩促銷（「限量促銷～30%OFF！」）就丟掉
      .map((seg) => seg.replace(SEASON_PREFIX, "").trim())
      .filter((seg) => seg && !isPromoOnly(seg));
    return kept.length ? kept.join("｜") + " " : "";
  });
  return s1.replace(/\s+/g, " ").replace(/^[｜|・\s　]+|[｜|・\s　]+$/g, "").trim() || s0;
}

/**
 * 比對用的鍵：在 displayPackage 之上再把所有標點與空白拿掉。
 * 只用來判斷「是不是同一個行程」，不拿來顯示。
 */
export function canonicalPackage(name: string): string {
  // 折成簡體再比：同一個行程有人用簡體下單時，逐字比會多分出一種方案（見 han-fold）
  return foldHan(displayPackage(name).replace(/[｜|・\s　（）()、,，&＆～~・\-－！!]+/g, ""))
    || String(name ?? "").trim();
}

/**
 * 原始方案名稱 → 這個「行程」的完整可讀名稱。
 * 行程相同的（canonical 一樣）會指到同一個字串，所以呼叫端要用**值的種類數**
 * 判斷有幾種方案，不是 key 的數量。
 */
export function shortPackages(names: string[]): Map<string, string> {
  const distinct = [...new Set(names.map((n) => String(n ?? "").trim()).filter(Boolean))];
  const out = new Map<string, string>();
  const firstOf = new Map<string, string>();
  for (const n of distinct) {
    const c = canonicalPackage(n);
    if (!firstOf.has(c)) firstOf.set(c, displayPackage(n));
    out.set(n, firstOf.get(c)!);
  }

  /**
   * 外語（英文）套餐名稱：同一條行程用外語賣的那一版（Ina 2026-08-19）。
   *   【1人成團】富田農場彩虹花田&美瑛四季彩之丘&白金青池一日遊
   *   [Guaranteed Departure for Solo Traveler] Farm Tomita – Rainbow Fields…
   * 字面上沒有一個字相同，折繁簡也救不了 → 會被算成第二種方案。
   *
   * 只在**中日文那側剛好只有一種行程**時才併：那時「還有第二條行程」這件事
   * 根本不存在，外語那筆必然是同一條的翻譯。中日文那側本來就有好幾種方案時
   * 不猜（併錯會讓客人少掉採果與午餐），維持分開，交給 ambiguousPlans 講話。
   */
  const hasCjk = (x: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(x);
  const foreign = distinct.filter((n) => !hasCjk(displayPackage(n)));
  const cjkGroups = new Set(distinct.filter((n) => hasCjk(displayPackage(n))).map((n) => out.get(n)!));
  if (foreign.length && cjkGroups.size === 1) {
    const only = [...cjkGroups][0];
    for (const n of foreign) out.set(n, only);
  }
  return out;
}

/** 「Ｂ方案：…」的方案字母。可能不在開頭——促銷剝掉後餐食那段會排在前面。 */
const planLetter = (s: string) =>
  (/([A-Za-zＡ-Ｚａ-ｚ0-9０-９])\s*方案\s*[：:]/.exec(String(s ?? "")) ?? ["", ""])[1];

/** 把「Ｘ方案：」那個 token 拿掉，其餘（前面的餐食、後面的行程）都留著。 */
const dropPlanToken = (s: string) =>
  String(s ?? "").replace(/[A-Za-zＡ-Ｚａ-ｚ0-9０-９]\s*方案\s*[：:]\s*/, "").trim();

/** 幾個字串裡最長的共同連續片段。用最短的那個當候選來源，長度夠用、寫法單純。 */
function longestCommon(xs: string[]): string {
  if (xs.length < 2) return "";
  const base = xs.reduce((a, b) => (a.length <= b.length ? a : b));
  for (let len = base.length; len >= 4; len--) {
    for (let i = 0; i + len <= base.length; i++) {
      const cand = base.slice(i, i + len);
      if (xs.every((x) => x.includes(cand))) return cand;
    }
  }
  return "";
}

/**
 * 幾種方案 → 每種的「代號」與「抬頭要寫的字」。
 *
 * 做法：**找出每個名稱都有的那一段（＝共同的行程），把它拿掉，剩下的就是差異。**
 * 不去猜哪些字是促銷——猜錯的代價很實際：528834 的 C 與 D 方案差在餐食
 *（水蜜桃吃到飽 vs 長腳蟹盛宴），那段一度被當成促銷剝掉，於是 B／C／D 三個方案的
 * 說明全變成「含「叢林巴士」搭乘費用」，導遊看不出誰吃什麼（Ina 2026-08-17 給實際頁面才發現）。
 *
 * 代號優先用名稱裡的方案字母（A／B／C／D）。另外配 A／B 會變成
 *「代號 A ＝ 方案Ｃ」，要在腦裡轉兩次，導遊一定會弄錯。
 *
 * 砍完若有人變成空的、或兩個變得一樣，就整個不砍——寧可長，也不能讓人分不出來。
 */
const CODES_ = "ABCDEFGHIJ";
export function planLabels(fulls: string[]): { code: string; label: string }[] {
  const letters = fulls.map(planLetter);
  const useLetter = letters.every(Boolean) && new Set(letters).size === fulls.length;
  const codeAt = (i: number) => (useLetter ? letters[i] : (CODES_[i] ?? "＊"));
  const tails = useLetter ? fulls.map(dropPlanToken) : fulls.slice();

  // 差異只在方案字母上（8/17 的Ｂ與Ｃ）→ 沒有可寫的字，交給呼叫端把行程名講一次
  if (tails.length > 1 && new Set(tails).size === 1) return fulls.map((_, i) => ({ code: codeAt(i), label: "" }));

  let cut = tails.slice();
  const common = longestCommon(tails);
  if (common) {
    /** 砍完會留下沒有另一半的括號（左括號在被砍掉的共同段裡）→ 去掉，不然像被截斷。 */
    const tidy = (x: string) => {
      let t = x.split(common).join(" ").replace(/\s+/g, " ")
        .replace(/^[\s、，／/｜|－\-～~]+|[\s、，／/｜|－\-～~]+$/g, "").trim();
      const open = (t.match(/[（(]/g) ?? []).length, close = (t.match(/[）)]/g) ?? []).length;
      if (close > open) t = t.replace(/[）)]\s*$/, "").trim();
      if (open > close) t = t.replace(/^\s*[（(]/, "").trim();
      return t;
    };
    const after = tails.map(tidy);
    if (after.every((x) => x.length >= 2) && new Set(after).size === after.length) cut = after;
  }
  return fulls.map((_, i) => ({ code: codeAt(i), label: cut[i] || "" }));
}

/**
 * 「這台車有好幾種方案，但導遊看不出差在哪」——判斷不出來就要**大聲講**（Ina 2026-08-17）。
 *
 * 真正的風險不是規則不夠聰明，是**它判斷錯了而沒人知道**：名單照印，只是印錯，
 * 等導遊在車上發現就來不及了。所以標籤重複或空白時回一句話，讓它出現在核對清單上。
 *
 * 回 null＝沒問題（只有一種方案，或每種方案的說明都不一樣）。
 */
export function ambiguousPlans(names: string[]): string | null {
  const fulls = [...new Set(shortPackages(names).values())];
  if (fulls.length < 2) return null;
  const marks = planLabels(fulls);
  const labels = marks.map((m) => m.label);
  if (labels.every(Boolean) && new Set(labels).size === labels.length) return null;
  const codes = marks.map((m) => m.code).join("／");
  return labels.every((l) => !l)
    ? `${fulls.length} 種方案（${codes}）的名稱除了代號以外完全一樣 → 導遊看不出差在哪，請確認要不要另外說明`
    : `${fulls.length} 種方案（${codes}）的說明有重複 → 導遊分不出誰是誰，請確認`;
}

/** 生日 YYYYMMDD → YYYY-MM-DD。設施的保險名冊要完整日期，不是年齡。 */
export function prettyBirthday(v: string): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : String(v ?? "");
}

/**
 * 備考欄拆成兩段：客人自己寫的、客服後來追加的。
 *
 * 為什麼要拆（Ina 2026-08-17）：「客服追加：與 26KK273700327 同行單」是**按訂單**掛上去的
 * （mergeCsNotes 用訂單編號比對），所以一張四人訂單的四列都被貼了同一句，
 * 導遊會以為是四件事。客服追加只印在第一列。
 *
 * 客人自己寫的那段**也只印第一列**。一度以為它可能一人一句（例如只有一位吃素）而保留逐列，
 * 但實際資料裡「也可以用 email 聯絡 xxx@gmail.com」「盡量不要安排旅遊巴後面座位」
 * 這些都是訂購人在訂單上寫的，一張訂單一份，同樣會四列重複（Ina 2026-08-17 指出）。
 * DAP 的備註欄本來就是**訂單層級**，不是旅客層級。
 *
 * 兩段仍然分開排版：客服追加另起一行、灰底，讓導遊看得出哪句是客人說的、哪句是我們補的。
 */
export function splitNote(note: string): { own: string; cs: string } {
  const s = String(note ?? "");
  const i = s.indexOf("客服追加：");
  if (i < 0) return { own: s, cs: "" };
  // 前面那個分隔的「｜」是我們加的，拆開後不要留在客人那段的尾巴
  return { own: s.slice(0, i).replace(/｜\s*$/, ""), cs: s.slice(i) };
}

/**
 * 通訊軟體那一格：**軟體名稱一定要跟帳號一起印**。
 *
 * ⚠️ 只印在**訂單第一列（代表人）**，跟訂單編號、訂購日、訂購人電話同一個處理方式
 *    （Ina 2026-08-17）：來源本來就只有訂購人那一筆，每列重複印會讓導遊以為
 *    一家四口各自有帳號、可以分別聯絡，實際上只有代表人能聯絡得上。
 *
 * 只印帳號的話，導遊看到一串數字不知道要加 LINE 還是 WhatsApp，加錯就聯絡不上客人
 * （Ina 2026-08-13）。認不得的代碼原樣印出並標問號，讓人看得出來是待確認、不是自動猜。
 */
function appCell(r: NamelistRow): string {
  if (!r.appAccount) return "";
  const unknown = /^\d{4}$/.test(r.appType);       // 還沒對照到名稱的原始代碼
  const label = r.appType ? `${r.appType}${unknown ? "（軟體待確認）" : ""}` : "";
  return label
    ? `<span class="app">${esc(label)}</span><br>${esc(r.appAccount)}`
    : esc(r.appAccount);
}

/**
 * ⏳ **這份名單還不是最終版**（Ina 2026-08-17）。
 *
 * 等 DAP 加上 **spec（商品選項）** 欄之後，要再多一欄，把客人訂購時選的東西顯示給導遊看
 * ——例如 621988 的「請選擇雪具」「請選擇房型」。導遊現在看不到，到現場才知道。
 *
 * 規格：旅客層級，格式 `問題：答案｜問題：答案`。
 * 欄位加在哪、要不要縮寫，**加之前先給 Ina 看預覽**，不要直接動主檔。
 * 接的順序：dap-source（欄位對應）→ guide-namelist（帶進 row）→ 這裡（多一欄）。
 */
export function namelistToHtml(d: NamelistDoc): string {
  // 大表解析時把橫槓拿掉了（比對用），但印給人看要斷成 080-6109-0963 才好唸、好抄。

  /**
   * ⚠️ 客人電話**照原樣印**，不重新分段：來源是訂單，各國分段規則不同。
   * 2026-08-15 一度套用日本的 3-3-4，把台灣手機 0912000000 切成 091-200-0000（應為 0912-000-000）。
   * 只有司機與導遊的電話（確定是日本號碼）才由我們補橫槓。
   */
  /**
   * 以**訂單**分群，不是以列分群（Ina 2026-08-15）。
   *
   * 原本是 `tr:nth-child(even)` 逐列深淺交替——交替是按「第幾列」算的，跟訂單無關，
   * 所以一家四口會被切成深淺深淺，視覺上正好把一家人拆開，跟導遊要的相反。
   *
   * 現在：同一張訂單共用一個底色，相鄰訂單換色（②）；訂單交界再加一條較粗的線（③）。
   * 底色負責遠看分群，線負責黑白列印或傳真時仍分得開——導遊在車上點名多半拿紙本。
   *
   * 訂單編號、訂購人電話都是**訂單層級**的資料，只印在該訂單第一列，
   * 並在編號後標「N 名」。每列重複同一組編號反而蓋掉了「這幾個人是一起的」這個訊息。
   *
   * ⚠️ **訂購日不印**（Ina 2026-08-17）：列的順序本身就是訂購順序（見下方 rows 的排序），
   *    再開一欄寫日期是同一件事講兩次，而導遊要的是「誰先訂」不是「幾點幾分訂的」。
   */
  /**
   * 方案名稱（Ina 2026-08-17 要求留著）：同一台車可能有不同方案的客人。
   * 只有一種方案時放抬頭、不佔一整欄；有兩種以上才開欄位，並簡化成看得出差別的部分。
   */
  /**
   * 方案（Ina 2026-08-17 要求留著）：同一台車可能有不同方案的客人。
   * 只有一種方案時放抬頭、不佔一整欄；兩種以上才開欄位，欄位裡只放代號。
   */
  // 包車的方案只留「6人成行｜專屬包車」。**這個轉換一定要跟下面查代號時用同一個函式**，
  // 否則 pkgMap 的鍵是轉換後的名字、查的時候用原名，代號就會查不到（查不到只會變空白，看不出來）
  const planNameOf = (r: NamelistRow) =>
    isCharter(r.productNo, r.packageName) ? shortCharterPlan(r.packageName) : r.packageName;
  const pkgMap = shortPackages(d.bus.rows.map(planNameOf));
  // ⚠️ 用「值的種類數」判斷，不是 pkgMap.size —— 行程相同的方案會有多個 key 指到同一個值
  const pkgFulls = [...new Set(pkgMap.values())];
  const manyPkg = pkgFulls.length > 1;
  const marks = planLabels(pkgFulls);
  const codeOfFull = new Map(pkgFulls.map((f, i) => [f, marks[i].code]));
  const pkgCode = new Map([...pkgMap].map(([orig, full]) => [orig, codeOfFull.get(full)!]));
  /**
   * 抬頭那行。所有標籤都空＝這幾個方案除了代號以外一模一樣（8/17 的Ｂ與Ｃ）→
   * 行程名講一次、代號並列，不要把同一串長名字印好幾遍。
   */
  const pkgLine = !manyPkg
    ? (pkgFulls.length === 1 ? `<b>${esc(pkgFulls[0])}</b>` : "")
    : marks.every((m) => !m.label)
      ? `${marks.map((m) => `<b>${esc(m.code)}</b>`).join("・")}　${esc(pkgFulls[0].replace(/^[^：:]{1,4}方案\s*[：:]\s*/, ""))}`
      : marks.map((m) => `<b>${esc(m.code)}</b> ${esc(m.label || "—")}`).join("・");

  /**
   * 規格（客人在訂單裡選的東西）。**一定要印**（Ina 2026-08-18）——
   * 包車商品的路線就在這裡，方案名稱只寫得出成團人數，看不出今天要去哪。
   *
   * 包車是一張訂單一台車，所以整台車通常只有一個值 → 放抬頭。
   * 萬一同一台車出現兩個以上（那多半是排錯了），全部列出來，
   * 不要只印第一個——那會讓人以為只有一種。
   */
  const specValues = [...new Set(d.bus.rows.flatMap((r) => meaningfulSpecs(r.specs)))];
  const specLine = specValues.length ? specValues.join("　／　") : "";

  /**
   * **依訂購時間排序**（Ina 2026-08-17）：這樣名單本身就帶著訂購順序，
   * 不用另外開一欄寫時間（訂購日那一欄因此拿掉了）。
   *
   * 同一張訂單的人一定連在一起——訂購時間與訂單編號都一樣，排序不會把他們拆開。
   * 時間相同時再用訂單編號決勝，這樣每次跑出來的順序都一致，重跑的兩份 PDF 才對得起來。
   *
   * ⚠️ 只在**印的時候**排。分車是照大表的分配走的（例 528834 的方案別車），
   *    在那之前動順序會改到誰上哪一台車。
   */
  /**
   * ⚠️ 同行單要**排在一起**，再照訂購順序（Ina 2026-08-17）。
   * 同行單是「不同訂單、但要坐在一起」的人。只照訂購時間排的話，同一組人中間
   * 可能隔著好幾張別人的訂單——導遊排座位得先在整張名單上把①找齊，
   * 那這個記號只幫了一半的忙。
   *
   * 三層，每一層都要能重現（重跑兩次要長一樣）：
   *   ① 這一組裡**最早那張訂單**的訂購時間 → 整組跟著最早的人走，
   *      不會因為同行的人晚訂就把整組往後推
   *   ② 同組之內照訂購時間　③ 同一張訂單的人維持原順序（Array.sort 是穩定的）
   */
  const groupKey = (r: NamelistRow) => d.companions.get(r.bookingNo) ?? `#${r.bookingNo}`;
  const groupFirst = new Map<string, string>();
  for (const r of d.bus.rows) {
    const k = groupKey(r), t = String(r.bookingDate);
    if (!groupFirst.has(k) || t < groupFirst.get(k)!) groupFirst.set(k, t);
  }
  const rows = [...d.bus.rows].sort((a, b) =>
    (groupFirst.get(groupKey(a)) ?? "").localeCompare(groupFirst.get(groupKey(b)) ?? "")
    || groupKey(a).localeCompare(groupKey(b))
    || String(a.bookingDate).localeCompare(String(b.bookingDate))
    || String(a.bookingNo).localeCompare(String(b.bookingNo)));

  /**
   * 同行記號①②③——**排序之後才編號**，照名單上出現的順序遞增。
   * 先編的話會出現「②排在①上面」，看的人會以為印錯。
   */
  const markOf = new Map<string, string>();
  for (const r of rows) {
    const root = d.companions.get(r.bookingNo);
    if (root && !markOf.has(root)) markOf.set(root, MARKS[markOf.size] ?? "＊");
  }

  /** 訂單編號 → 已經印過的備註內容（見 cell 裡的說明）。 */
  const notesSeen = new Map<string, Set<string>>();
  let gi = -1, prevBooking: string | null = null;
  const groupSize = new Map<string, number>();
  for (const r of rows) groupSize.set(r.bookingNo, (groupSize.get(r.bookingNo) ?? 0) + 1);

  const cell = (r: NamelistRow) => {
    const first = r.bookingNo !== prevBooking;
    if (first) { gi++; prevBooking = r.bookingNo; }
    const n = groupSize.get(r.bookingNo) ?? 1;
    const mark = markOf.get(d.companions.get(r.bookingNo) ?? "") ?? "";
    const cls = [gi % 2 ? "gb" : "ga", first && gi > 0 ? "gt" : ""].filter(Boolean).join(" ");
    /**
     * 備考**按內容去重，不是按位置**（2026-08-17 做多方案 demo 時發現的坑）。
     * 原本寫 `first ? ... : ""`，同一張訂單只印第一列——真實資料裡備註是訂單層級、
     * 每列都一樣，所以看起來沒問題；但只要哪天有一列的備註不一樣，那句就會安靜消失。
     * 改成「這張訂單已經印過同一句就不再印」：重複的不佔版面，不一樣的一定看得到。
     */
    const nt = splitNote(r.note);
    const seen = notesSeen.get(r.bookingNo) ?? new Set<string>();
    notesSeen.set(r.bookingNo, seen);
    const showOwn = !!nt.own && !seen.has("o:" + nt.own);
    const showCs = !!nt.cs && !seen.has("c:" + nt.cs);
    if (showOwn) seen.add("o:" + nt.own);
    if (showCs) seen.add("c:" + nt.cs);
    return `<tr class="${cls}">
      <td class="mid">${first ? esc(r.bookingNo) : ""}${first && mark ? `<span class="mk">${mark}</span>` : ""}${first && n > 1 ? `<span class="cnt">${n} 名</span>` : ""}</td>
      <td class="nm">${esc(r.enName)}</td>
      <td class="c">${esc(r.gender)}</td>
      <td class="c bd2">${esc(prettyBirthday(r.birthday))}</td>
      <td class="c">${esc(r.age >= 0 ? r.age : "")}</td>
      ${manyPkg ? `<td class="c pk">${esc(pkgCode.get(planNameOf(r).trim()) ?? "")}</td>` : ""}
      <td class="c">${esc(r.nationality)}</td>
      <td class="ph">${first ? esc(r.buyerPhone) : ""}</td>
      <td class="ph">${first ? appCell(r) : ""}</td>
      <td class="nt">${first && mark ? `<span class="cmp">${mark} 同行單，請安排同車鄰座</span>` : ""}${showOwn ? esc(nt.own) : ""}${showCs ? `<span class="cs">${esc(nt.cs)}</span>` : ""}</td>
    </tr>`;
  };

  /**
   * 車別只在**真的分車時**才標（A 車／B 車）。
   * 原本單車也印「單一車」——那是不需要說明的情況，反而佔掉抬頭；
   * 而不用車的行程（30651 走鐵道＋遊船）印「單一車」根本是錯的（Ina 2026-08-15）。
   */
  const noVeh = d.usesVehicle === false;
  const carLabel = !noVeh && d.bus.carLetter ? `${d.bus.carLetter} 車` : "";
  const cap = !noVeh && d.bus.capacity != null ? `／位空 ${d.bus.capacity}` : "";
  /**
   * 同行單的說明改放**該列的備考欄**（Ina 2026-08-15），不再放表格下方的圖例。
   * 導遊點名是一列一列看的，把意思寫在那一列上，不用再往下找對照。
   *
   * ⚠️ 同行註記**只印在訂單第一列**（Ina 2026-08-17）。四個人的訂單原本四列都印同一句，
   *    把客人自己寫的備註往下擠、還讓人以為是四件不同的事。記號 ① 本來就標在
   *    訂單編號旁邊，一張訂單講一次就夠。
   *
   * ⚠️ 備考欄**只用中文**（Ina 2026-08-17）。表格其他地方是日文為主、中文小字，
   *    但備考欄印的是客人自己寫的原文（中文），我們加的同行註記再配一行日文，
   *    同一格就變成日中日中四行，看的人分不出哪句是客人說的、哪句是我們標的。
   */
  // 排序規則要寫出來，不然「為什麼是這個順序」只有寫程式的人知道（Ina 2026-08-17）
  const legend = `<p class="rule">※ 同行のご予約はまとめて、その他はご予約日時の早い順<span class="zhi">同行單排在一起，其餘依訂購時間由早到晚</span></p>`;

  // 車輛與司機：導遊到現場第一件事是找車、找司機 → 放在名單**上方**，不能埋在頁尾
  const v = d.vehicle ?? {};
  // 車公司還沒回報時不留空白，直接寫「司機資訊後給」——空白會讓導遊以為是漏印
  /**
   * 司兼導與純司機**不能都叫「乗務員」**（Ina 2026-08-15）：
   *   司兼導＝帶團的人同時開車 → ガイド兼ドライバー
   *   純司機＝我方另派導遊，這位只開車 → 運転手
   * 稱呼錯了，車公司會以為我們搞不清楚派的是誰。
   */
  const isGD = d.bus.serviceMode === "司兼導";
  const roleJa = isGD ? "ガイド兼ドライバー" : "運転手";
  const roleZh = isGD ? "司兼導" : "司機";
  /**
   * 還沒拿到資訊時那格要寫什麼，**取決於這份名單寄給誰**（Ina 2026-08-15）：
   *   司兼導 → 名單寄**車公司**，他們就是該提供的人 → 寫「請儘快提供」
   *   純司機 → 名單寄**導遊**，導遊是等的一方 → 寫「稍後會通知您」
   * 兩者共用一句話的話，等於跟車公司說「等別人給你」，收件人與語意完全相反。
   */
  const later = isGD
    ? `<span class="tbd">本日 16:00 までにご連絡ください／請於今日 16:00 前提供</span>`
    : `<span class="tbd">${roleJa}情報は本日中にご連絡／${roleZh}資訊稍後提供</span>`;
  const drv = (v.drivers ?? []).filter((x) => x && x.name);
  /** 帶子裡的一格：標籤（日文＋中文小字）在上、值在下。 */
  const seg = (ja: string, zh: string, val: string) =>
    `<div class="seg"><span class="k">${ja}<span class="zhi">${zh}</span></span><span class="v">${val}</span></div>`;
  /**
   * 一位司機＝**一格**，姓名與電話收在同一格內（Ina 2026-08-15）。
   * 原本是「運転手1｜電話｜運転手2｜電話」四格並排，看不出哪支電話配哪個人——
   * 加分隔線也只是分隔，配對還是要靠猜。收在同一格，配對關係就內建在版面裡。
   * 兩位以上時，第二位起加一條較深的左框線隔開。
   */
  const drvSegs = drv.length
    ? drv.map((x, i) => `<div class="seg${i > 0 ? " sep" : ""}">`
        + `<span class="k">${roleJa}${drv.length > 1 ? i + 1 : ""}<span class="zhi">${roleZh}</span></span>`
        + `<span class="v">${esc(x.name)}</span>`
        + (x.phone ? `<span class="sub">${esc(prettyPhone(x.phone))}</span>` : "")
        + (x.imAccount ? `<span class="sub">${esc(x.imType || "通訊")} ${esc(x.imAccount)}</span>` : "")
        + `</div>`).join("")
    : seg(roleJa, roleZh, later);
  /**
   * 頁尾的「ガイド／導遊」只對**純司機團**有意義——那是我方另派的導遊。
   * 司兼導團開車的人就是帶團的人，資訊已經印在上方車輛欄，
   * 再留一格空白的導遊欄會讓人以為還有一位沒到（Ina 2026-08-15）。
   */
  const footer = `<p class="foot"><span>計 <b>${d.bus.total}</b> 名<span class="zhi">合計人數</span></span>`
    + (isGD ? "" : `<span>ガイド<span class="zhi">導遊</span> <b>${esc(d.guideName ?? "＿＿＿＿＿")}</b></span>`
      + `<span>電話番号<span class="zhi">電話</span> <b>${esc(prettyPhone(d.guidePhone) || "＿＿＿＿＿")}</b></span>`)
    + `</p>`;

  /**
   * 車輛資訊獨立成一條橫跨整寬的帶子（Ina 2026-08-15 選定 C3a）。
   * 為什麼不放在標題右邊：商品名很長
   *（「【含 1 人成團方案】積丹半島一日遊｜積丹水中展望船・小樽運河・神威岬」），
   * 雙欄抬頭會把標題擠成兩三行、右邊卡片被推下去。
   */
  /**
   * ⚠️ **車公司名稱只印給車公司自己看**（Ina 2026-08-17）。
   * 純司機團的名單是寄給**導遊**的，而導遊有時是別家地接社派來的——
   * 讓他看到我們用哪家巴士公司，等於把供應商關係攤給可能的競爭對手。
   * 「請你派導遊」跟「請你派車」是兩件獨立的事，沒有必要互相知道。
   * 導遊要找到車靠的是車號＋司機姓名＋電話，那三項都還在。
   *
   * 司兼導團的名單收件人就是車公司本人 → 照印（藏他們自己的名字沒有意義）。
   */
  const showCompany = isGD;
  const vehicleBox = d.usesVehicle === false ? "" : `<div class="band">
    ${seg("車両番号", "車號", v.plate ? esc(v.plate) : later)}
    ${showCompany ? seg("バス会社", "車公司", v.company ? esc(v.company) : later) : ""}
    ${drvSegs}
  </div>`;

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(d.productName)} ${esc(d.departureDate)}</title><style>
  /* 配色與間距一律用 KKday design system 的 token 值，不自創顏色（skills/kkday-design-system）。
     這是列印文件，所以只取 token 的「值」，不引入整包 CSS：
       primary #26BEC9（品牌）· text darker #212121 · text medium #9C9DA0
       border light #D5D6DB · surface lighter #F7FAFC · radius md 8px */
  @page { size: A4; margin: 10mm; }
  body { font: 11px/1.5 "Hiragino Sans","Noto Sans TC",sans-serif; color:#212121; }
  /* 抬頭：左邊 logo，右邊行程名。導遊拿到手第一眼要確認「這是不是我這團」 */
  /* 抬頭吃滿整行：商品名很長，擠在左半邊會斷成兩三行 */
  .hd { border-left:3px solid #26BEC9; padding-left:10px; margin-bottom:9px; }
  .hd img { height:16px; display:block; margin-bottom:6px; }
  h1 { font-size: 15px; margin:0; color:#212121; }
  .sub { font-size: 11px; color:#9C9DA0; margin:2px 0 0; }
  .sub b { color:#212121; }
  table { width:100%; border-collapse:collapse; }
  th,td { border:1px solid #D5D6DB; padding:4px 5px; vertical-align:top; }
  th { background:#F7FAFC; font-weight:600; white-space:nowrap; color:#212121;
       border-bottom:2px solid #26BEC9; }
  /* 同訂單同底色（②）＋訂單交界一條較粗的線（③）。逐列交替已移除——見 cell() 的說明。 */
  tbody tr.ga td { background:#FFFFFF; }
  tbody tr.gb td { background:#F4F9FA; }
  tbody tr.gt td { border-top:1.5px solid #9FB3B8; }
  .cnt { margin-left:6px; font-size:9.5px; color:#0E6E75; background:#E8F6F7;
         border-radius:3px; padding:1px 5px; font-weight:700; }
  .c { text-align:center; white-space:nowrap; }
  .mid,.ph { white-space:nowrap; font-variant-numeric:tabular-nums; }
  /* 姓名不斷行：斷成兩行時導遊點名要多看一眼，且護照姓名本來就不該被拆開（Ina 2026-08-15）。
     備註仍是最寬的欄，只是讓出一點給姓名。 */
  .nm { font-weight:600; white-space:nowrap; }
  /* 備考是唯一長度不可控的欄（客人自由填寫）→ 給它最寬，其餘欄位都能靠內容自適應。
     實測 60 字的日文備註會折成四行，仍在同一頁內（Ina 2026-08-15 壓力測試）。 */
  .nt { width:30%; }
  /* 訂購日：DAP 給的就是日本時間，直接照印不換算（Ina 2026-08-15 確認可用 JST）。
     日期與時間拆兩行，才不會把整列撐寬。 */
  .bd { white-space:nowrap; font-size:10px; color:#444; font-variant-numeric:tabular-nums; }
  .tz { font-size:9px; color:#777; margin-left:3px; font-weight:400; }
  .mk { margin-left:4px; font-weight:700; }
  /* 同行註記：跟客人自己填的備註區分開——一個是我們標的，一個是客人寫的 */
  .cmp { display:block; font-size:10px; color:#0E6E75; background:#E8F6F7;
         border-radius:3px; padding:2px 5px; margin-bottom:3px; line-height:1.45; }
  /* 中文要自成一行：接在日文後面會斷在句子中間（「請安／排同車鄰座」），看起來像壞掉 */
  .cmp .zhi { display:block; margin-left:0; color:#0E6E75; opacity:.85; }
  /* 客服追加：跟客人自己寫的原文要看得出是兩回事 → 另起一行、灰底 */
  /* 生日是保險名冊要的完整日期，跟年齡分開兩欄（Ina 2026-08-17）——
     設施要的是生日、導遊點名看的是年齡，兩件事各自要一眼找得到 */
  .bd2 { font-variant-numeric:tabular-nums; white-space:nowrap; }
  /* 排序規則的註記：字小、放表格正下方，看得到但不搶版面 */
  .rule { font-size:10px; color:#9C9DA0; margin:4px 0 0; }
  .rule .zhi { margin-left:6px; }
  /* 方案：完整名稱在抬頭對照一次，欄位裡只放代號 A／B／C */
  .pkl { font-size:12px; margin:3px 0 0; color:#212121; }
  .pkl b { color:#0E6E75; }
  .pk { font-weight:700; color:#0E6E75; }
  .cs { display:block; margin-top:3px; font-size:10px; color:#212121;
        background:#F7FAFC; border-left:2px solid #D5D6DB; padding:2px 5px; border-radius:4px; }
  .app { font-size:9.5px; font-weight:700; color:#555; }   /* 軟體名稱：比帳號小一級，但一眼看得到 */
  .legend { font-size:11px; color:#555; margin:6px 0 0; }
  /* 雙語：日文為主、中文小一級放下面（Ina 2026-08-15 決定）。
     收件人是日本導遊與車公司，日文放前面最好讀；中文留給我方窗口核對。 */
  .zh { display:block; font-size:9px; color:#666; font-weight:400; }
  .zhi { font-size:10px; color:#666; font-weight:400; margin-left:3px; }
  .foot { margin-top:10px; font-size:12px; }
  /* 導遊姓名與電話是現場真的會用到的資訊，跟車輛帶裡的值同一層級 → 一樣加粗 */
  .foot b { font-weight:700; color:#212121; font-variant-numeric:tabular-nums; }
  .foot span { display:inline-block; margin-right:24px; }
  /* 車輛帶（C3a）：等寬分格，左緣一條品牌色定位。
     每格「標籤在上、值在下」——車號與電話是要照著念、照著撥的，值要看得清楚。 */
  .band { display:flex; border:1px solid #D5D6DB; border-left:3px solid #26BEC9;
          border-radius:8px; overflow:hidden; background:#F7FAFC; margin:0 0 8px; }
  .band .seg { flex:1; padding:7px 12px; border-right:1px solid #E4EAEC; min-width:0; }
  .band .seg:last-child { border-right:0; }
  .band .k { display:block; font-size:9px; color:#61757D; letter-spacing:.04em; }
  .band .v { font-size:12px; font-weight:700; color:#212121;
             font-variant-numeric:tabular-nums; word-break:break-all; }
  /* 電話跟在姓名下面＝這兩個是同一個人的（見 drvSegs 的說明） */
  .band .sub { display:block; font-size:11px; color:#3D4B52;
               font-variant-numeric:tabular-nums; margin-top:1px; }
  /* 第二位司機起加深左框，兩個人之間才分得開 */
  .band .seg.sep { border-left:1px solid #9FB3B8; }
  .veh b { color:#000; }
  .veh .tbd { display:inline; color:#8a5a00; background:#fff3d6; border:1px dashed #d6a640;
              border-radius:3px; padding:0 4px; font-size:11px; }
</style></head><body>
<div class="hd">
  <img src="${KKDAY_WORDMARK}" alt="KKday">
  <h1>${esc(d.productName)}</h1>
  ${pkgLine ? `<p class="pkl">プラン<span class="zhi">方案</span>　${pkgLine}</p>` : ""}
  ${specLine ? `<p class="pkl">当日コース<span class="zhi">當天路線</span>　<b>${esc(specLine)}</b></p>` : ""}
  <p class="sub">出発日<span class="zhi">出發日</span> <b>${esc(d.departureDate)}</b>　ツアー番号<span class="zhi">團號</span> <b>${esc(d.bus.tourCode || "－")}</b>${carLabel ? "　" + esc(carLabel) + esc(cap) : ""}　商品番号<span class="zhi">商品編號</span> ${esc(d.productNo)}　計 <b>${d.bus.total}</b> 名<span class="zhi">人</span></p>
</div>
${vehicleBox}
<table>
  <thead><tr>
    <th>注文番号<span class="zh">訂單編號</span></th>
    <th>お客様氏名<span class="zh">旅客姓名</span></th>
    <th>性別<span class="zh">性別</span></th>
    <th>生年月日<span class="zh">生日</span></th>
    <th>年齢<span class="zh">年齡</span></th>
    ${manyPkg ? '<th>プラン<span class="zh">方案</span></th>' : ""}
    <th>国籍<span class="zh">國籍</span></th>
    <th>代表者電話<span class="zh">訂購人電話</span></th>
    <th>連絡アプリ<span class="zh">通訊軟體</span></th>
    <th>備考<span class="zh">備註</span></th>
  </tr></thead>
  <tbody>${rows.map(cell).join("")}</tbody>
</table>
${legend}
${footer}
</body></html>`;
}
