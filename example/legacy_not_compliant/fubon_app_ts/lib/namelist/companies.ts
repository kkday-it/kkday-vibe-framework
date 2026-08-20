/**
 * 車公司名單（導遊 Email 表的第二個分頁「車公司名單」）。
 *
 * 用途：**司兼導的團，名單寄給車公司窗口轉交**（Ina 2026-08-06）——
 * 司兼導是車公司的人，我們沒有他個人信箱，也不需要。
 *
 * 難點：大表車型欄寫的是簡稱（「櫻華 14座」「北之旅49座大巴 位空44」），
 * 名單表寫的是正式名（「櫻華國際」「株式会社サンシャイン貿易」）→ 要模糊比對。
 * 比對不到就明講「這台車的車公司對不到名單」，絕不亂寄。
 */
export type BusCompany = {
  supplierOid: string; name: string; email: string; ok: boolean;
  /** 別名／俗稱（名單表新增欄位，可用「、」「,」「/」分隔多個）。
   *  大表現場寫的是簡稱或中文名（「星虎大巴」），名單表寫正式名（STAR TIGER TRAVEL）→ 靠這欄搭橋。 */
  aliases: string[];
};

/**
 * ⚠️ 以下的字形正規化**只用於比對**，絕不能拿去顯示。
 *    公司名是專有名詞，一律照名單表上的原始寫法印（Ina 2026-08-15）——
 *    「株式会社サンシャイン貿易」就印那樣，不要變成「陽光貿易」；
 *    「龍藤観光株式会社」也不要被轉成繁體。matchCompany() 回傳的是原始物件，
 *    呼叫端請一律用 c.name。
 *
 * 日文漢字 ↔ 繁體的常見對應。大表寫繁體（龍藤觀光、357觀光），名單表寫日文漢字（龍藤観光、357観光），
 * 差一個字就配不到 → 程式自己吃掉，不要浪費 AM 去填這種別名。
 */
const JP2TW: Record<string, string> = {
  観: "觀", 会: "會", 社: "社", 国: "國", 沢: "澤", 駅: "驛", 実: "實", 万: "萬",
  竜: "龍", 沖: "沖", 桜: "櫻", 学: "學", 気: "氣", 帰: "歸", 図: "圖", 発: "發",
  県: "縣", 広: "廣", 経: "經", 転: "轉", 楽: "樂", 亜: "亞", 内: "內", 号: "號",
};

/** 全形英數→半形，日文漢字→繁體，英文一律小寫。比對前兩邊都要過。 */
function normChars(s: string): string {
  return String(s ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\u4e00-\u9fff]/g, (c) => JP2TW[c] ?? c)
    .toLowerCase();
}

/** 去掉公司型態、空白與括號註記，只留核心字（比對用）。 */
export function coreName(s: string): string {
  return normChars(String(s ?? "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/株式会社|株式會社|有限会社|合同会社|合同會社|股份有限公司|有限公司|Co\.,?\s*Ltd\.?|Inc\.?/gi, "")
    .replace(/[\s　・･＿_]/g, "")
    .trim());
}

/** 把 A1:E 的值轉成清單（欄位用標題文字找，欄序可能被調動）。 */
export function parseCompanies(rows: string[][]): BusCompany[] {
  const hdr = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const at = (re: RegExp) => hdr.findIndex((c) => re.test(c));
  const cOid = at(/Oid/i), cName = at(/Name|公司/i), cMail = at(/mail/i), cOk = at(/確認/);
  const cAlias = at(/別名|暱稱|俗稱|簡稱|Alias/i);
  const out: BusCompany[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = String(r[cName] ?? "").trim();
    if (!name) continue;
    out.push({
      supplierOid: String(r[cOid] ?? "").trim(),
      name,
      email: String(r[cMail] ?? "").trim(),
      ok: String(r[cOk] ?? "").trim().toUpperCase() === "TRUE",
      aliases: cAlias >= 0
        ? String(r[cAlias] ?? "").split(/[、,，\/／]/).map((x) => x.trim()).filter(Boolean)
        : [],
    });
  }
  return out;
}

/**
 * 車型欄文字要先去掉座數／位空／車型等雜訊，只留公司名那段。
 * 例「櫻華 14座」→「櫻華」、「北之旅49座大巴 位空44」→「北之旅」。
 */
export function busCore(busText: string): string {
  let t = String(busText ?? "").split(/[\n\r]/)[0];
  t = t.replace(/位空\s*[:：]?\s*\d+/g, "")
       .replace(/\d+\s*(座|人座|席|名)/g, "")
       .replace(/大巴|中巴|小巴|バス|海獅|雙司機|司兼導|全含|含稅|税込|稅入/g, "")
       // 只拿掉金額（有幣別符號或含逗號、或 4 位數以上）——不能連「357観光」的 357 都砍掉
       .replace(/[¥￥][\d,]+/g, "")
       .replace(/\d[\d,]{3,}/g, "");
  return coreName(t);
}

/**
 * 從大表車型欄文字找出是哪家車公司。
 * 兩邊都取核心字後互相包含即算命中；命中多家就回 null（寧可讓人決定，不亂猜）。
 */
export function matchCompany(busText: string, list: BusCompany[]): BusCompany | null {
  const t = busCore(busText);
  if (!t) return null;
  const hits = list.filter((c) => {
    // 正式名與所有別名都比一次，任一命中就算
    return [c.name, ...c.aliases].some((cand) => {
      const n = coreName(cand);
      return n.length >= 2 && (t.includes(n) || n.includes(t));
    });
  });
  return hits.length === 1 ? hits[0] : null;
}
