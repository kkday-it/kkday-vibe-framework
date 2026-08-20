/**
 * 大表（JP自社ツアー一覧表）讀取層。
 *
 * 為什麼要獨立一支：大表是「這天到底有沒有團出發」的**權威來源**——
 * 有團就有那天的團號列（KK260803-184638A），沒出發就沒有。
 * 班表只說「誰哪天上班」，多日團會佔掉連續好幾格，光看班表分不出
 * 「第二天續行」與「連兩天各出一團」。所以兩邊都要問，且以大表為準。
 *
 * 一切用標題文字找欄位，不寫死欄號（177 分頁、欄名 70 幾種寫法，人還會搬欄位）。
 * ⚠️ **列數也不能寫死**：分頁是逐年往下累積的，「30651 嵐山」有 4094 列，
 *    2026/8 的團在第 3123 列 —— 之前寫 A1:BZ600 直接讀不到，還誤判成「這天沒團」。
 *    範圍一律寫 A1:BZ（不帶列號）＝讀到最後一列。
 */
import { google } from "googleapis";
import { getGoogleAuth } from "../insurance/google-auth.ts";
import { findBuckets, type BusBucket } from "./bus-buckets.ts";

export const BIG_SHEET_ID = "1PLbK829sJqoHtumEaUzAmHsqVcB7A-BH8qZR-oo45aY";

export type Cols = { tour: number; bus: number; total: number | null; guide?: number; driver?: number };

/**
 * 同一張分頁常有好幾欄長得像同一件事，例 39100 積丹：
 *   L 欄「導遊手配書」（給供應商的文件連結）  M 欄「導遊」（真正的人）
 * 原本「第一個含『導遊』的欄」→ 抓到 L 欄手配書，M 欄的資訊一路讀不到，
 * 而且表面上完全正常（只是永遠讀成空白）。實測 126 個分頁裡有 12 個是這種情況。
 *
 * 改成給分挑最像的那一欄：完全相符最好，其次是開頭相符，
 * 帶「手配／書／備考／費用」這種修飾字的排最後——那些是文件或註記，不是人。
 * 一個都沒有就回 -1（＝這張分頁沒這一欄，不是空白）。
 */
export function pickCol(hdr: string[], re: RegExp): number {
  const MODIFIER = /手配|書|備考|費用|代金|請求|確認|連絡票/;
  const cands = hdr
    .map((h, i) => ({ h: h.trim(), i }))
    .filter((x) => re.test(x.h))
    .map((x) => ({
      i: x.i,
      // 分數越小越優先
      score: (MODIFIER.test(x.h) ? 4 : 0)
        + (new RegExp(`^(${re.source})$`).test(x.h) ? 0 : re.test(x.h.slice(0, 4)) ? 1 : 2)
        + Math.min(x.h.length / 100, 0.9),   // 同分時取比較短的（修飾字越少越可能是本體）
    }))
    .sort((a, b) => a.score - b.score || a.i - b.i);
  return cands.length ? cands[0].i : -1;
}

/** 團號長相：KK + 6或8碼日期 + '-' + 商品編號。用來在沒有「團號」標題時反推是哪一欄。 */
const TOUR_CELL_RE = /^KK(\d{6}|\d{8})-\d{3,8}/;

/**
 * 在前 10 列裡找標題列（各分頁在第 1~7 列都有），並定位需要的欄。
 *
 * 兩種找法，缺一不可：
 *   ① 標題列有「團號」二字——126 個分頁裡 113 個是這樣。
 *   ② 沒有「團號」二字時，靠**內容**反推（2026-08-15 加）。
 *      多日遊分頁（立山3日、黑部峽谷2日、下呂點燈二日…）把那一欄的標題直接寫成
 *      「158778 立山黑部三日遊」——是商品名，不是「團號」。原本整張分頁被跳過，
 *      **而且不會有任何錯誤訊息**：整個多日遊類別對大表掃描是隱形的
 *      （Ina 2026-08-15 問「158778 為什麼沒有團號」才發現，實測 8 個分頁受影響）。
 */
export function locateCols(rows: string[][]): { hi: number; cols: Cols } | null {
  const build = (i: number, tourIdx: number) => {
    const hdr = rows[i].map((c) => String(c ?? "").replace(/\n/g, " ").trim());
    const idx = (re: RegExp) => hdr.findIndex((c) => re.test(c));
    return {
      hi: i,
      cols: {
        tour: tourIdx,
        bus: idx(/巴士|バス|車型/),
        total: idx(/合計|總人數|^人數$/),
        guide: pickCol(hdr, /導遊|ガイド|添乗/),
        driver: pickCol(hdr, /司機|ドライバー|運転/),
      },
    };
  };

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (!rows[i]?.some((c) => /團號/.test(String(c ?? "")))) continue;
    const hdr = rows[i].map((c) => String(c ?? "").replace(/\n/g, " ").trim());
    return build(i, hdr.findIndex((c) => /團號/.test(c)));
  }

  // ② 退而求其次：找一列同時像「出發日期」與「巴士／車型」的標題列，
  //    團號欄則取**下方資料列裡最常出現 KK 團號的那一欄**——用內容認，不猜標題怎麼寫。
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const hdr = (rows[i] ?? []).map((c) => String(c ?? "").replace(/\n/g, " ").trim());
    /**
     * 🔴 比對前先把**空白全部去掉**（2026-08-20）。
     *
     * 大表有些分頁的標題寫成「出發（換行）日期」，上面把換行換成空格之後變「出發 日期」，
     * 而這個字串沒有空格 → 對不上 → 整張分頁認不出標題列、被安靜跳過。
     * 實測受影響：153708 SPK戲雪、262036 白川＋牧歌（Ina 2026-08-20 問「其他沒被體檢到的
     * 我要擔心嗎」時查出來的）。那兩張那天剛好沒有團，但同樣的寫法哪天出現在有團的分頁上，
     * 那一團就會完全隱形。
     */
    const nospace = (c: string) => c.replace(/[\s　]/g, "");
    if (!hdr.some((c) => /出發日期|出発日|出团日|出團日/.test(nospace(c)))) continue;
    if (!hdr.some((c) => /巴士|バス|車型/.test(c))) continue;
    const hits = new Map<number, number>();
    for (let r = i + 1; r < rows.length; r++) {
      (rows[r] ?? []).forEach((cell, c) => {
        const first = String(cell ?? "").split(/[\n\r]/)[0].trim().toUpperCase().replace(/\s+/g, "");
        if (TOUR_CELL_RE.test(first)) hits.set(c, (hits.get(c) ?? 0) + 1);
      });
    }
    if (!hits.size) continue;                      // 認不出團號欄就不要硬給，回 null 讓上游知道問不到
    const tour = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    return build(i, tour);
  }
  return null;
}

export type BigSheet = {
  /** 該商品該出發日的所有車；分頁找不到／沒有團號欄 → null（＝問不到，不等於沒團）。 */
  buckets(productNo: string, date: string): Promise<BusBucket[] | null>;
};

export async function openBigSheet(): Promise<BigSheet> {
  const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const s = google.sheets({ version: "v4", auth });
  const meta = await s.spreadsheets.get({ spreadsheetId: BIG_SHEET_ID, fields: "sheets.properties(title)" });
  const tabs = (meta.data.sheets ?? []).map((x) => String(x.properties!.title));
  const cache = new Map<string, BusBucket[] | null>();

  return {
    async buckets(productNo, date) {
      const key = `${productNo}@${date}`;
      if (cache.has(key)) return cache.get(key)!;
      const tab = tabs.find((t) => t.trim().startsWith(productNo));
      let out: BusBucket[] | null = null;
      if (tab) {
        const r = await s.spreadsheets.values.get({
          spreadsheetId: BIG_SHEET_ID, range: `'${tab.replace(/'/g, "''")}'!A1:BZ`,
        });
        const rows = (r.data.values ?? []) as string[][];
        const loc = locateCols(rows);
        if (loc && loc.cols.tour >= 0) out = findBuckets(rows, loc.cols, date, loc.hi);
      }
      cache.set(key, out);
      return out;
    },
  };
}

/**
 * 掃大表**全部**商品分頁，回報某一天到底有哪些團。
 *
 * 為什麼要全掃：「四天成團」「明天出團(名單)」那幾個區塊只涵蓋部分商品
 * （實測 8/9 只涵蓋 4 個裡的 1 個），拿它當清單會安靜漏團。
 * 隱藏的分頁也照掃——OP 隱藏通常代表停用，但萬一隱藏了還有團的分頁，只掃顯示中的就會整團消失。
 *
 * 目前用途：名單零筆時，判斷「今天真的沒有團」還是「名單沒讀到」——兩者長得一模一樣。
 */
export async function scanToursOn(date: string): Promise<{ productNo: string; tab: string; buckets: BusBucket[] }[]> {
  return (await scanToursOnDates([date])).get(date) ?? [];
}

/**
 * 多天版：分頁只讀**一次**，然後對每個日期各跑一次 findBuckets。
 *
 * 為什麼要這支：「回報狀況」要看今天～後天共三天，用 scanToursOn 跑三次就是把
 * 126 個分頁讀三遍（實測單次就要十幾秒）。分頁內容跟日期無關，讀一次就夠。
 *
 * ⚠️ 這裡是**唯一**知道「哪天有哪些團」的可靠來源。原本「回報狀況」改用
 *    大表「每日總表確認」當清單，結果漏掉整整一天：那張表只有 明天／+4／+7／+14
 *    四個檢查點，D+2 根本不在上面（2026-08-15 Ina 發現 8/17 五團都不見了）。
 */
export async function scanToursOnDates(
  dates: string[],
): Promise<Map<string, { productNo: string; tab: string; buckets: BusBucket[] }[]>> {
  const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const s = google.sheets({ version: "v4", auth });
  const meta = await s.spreadsheets.get({ spreadsheetId: BIG_SHEET_ID, fields: "sheets.properties(title)" });
  const tabs = (meta.data.sheets ?? []).map((x) => String(x.properties!.title)).filter((t) => /^\d{4,7}/.test(t.trim()));
  if (!tabs.length) {
    // 一個商品分頁都認不出來＝大表結構變了。安靜回空會讓下游印出「今天沒有團」。
    throw new Error("大表找不到任何商品分頁（分頁名應以商品編號開頭）→ 已中止，避免誤判成沒有團");
  }
  const out = new Map<string, { productNo: string; tab: string; buckets: BusBucket[] }[]>();
  dates.forEach((d) => out.set(d, []));
  for (let i = 0; i < tabs.length; i += 40) {
    const part = tabs.slice(i, i + 40);
    const ranges = part.map((t) => `'${t.replace(/'/g, "''")}'!A1:BZ`);
    const res = await s.spreadsheets.values.batchGet({ spreadsheetId: BIG_SHEET_ID, ranges });
    // 合併儲存格 values API 不回，要另外問（只問這批分頁）—— 見 fillMerged
    const meta2 = await s.spreadsheets.get({
      spreadsheetId: BIG_SHEET_ID, ranges, fields: "sheets(properties(title),merges)",
    });
    const mergesOf = new Map<string, MergeRange[]>();
    for (const sh of meta2.data.sheets ?? []) mergesOf.set(String(sh.properties!.title), (sh.merges ?? []) as MergeRange[]);
    (res.data.valueRanges ?? []).forEach((vr, j) => {
      const tab = part[j];
      const raw = (vr.values ?? []) as string[][];
      const loc = locateCols(raw);
      if (!loc || loc.cols.tour < 0) return;
      const rows = fillMerged(raw, mergesOf.get(tab) ?? [], [loc.cols.tour]);
      const productNo = (/^\d{3,8}/.exec(tab.trim()) ?? [""])[0];
      for (const d of dates) {
        const bk = findBuckets(rows, loc.cols, d, loc.hi);
        if (bk.length) out.get(d)!.push({ productNo, tab, buckets: bk });
      }
    });
  }
  return out;
}

/**
 * 同一個商品編號常有好幾個分頁（大表實測 10 個商品這樣）：
 *   30651 → 「30651嵐山七月異動」〔隱藏〕、「30651-嵐山-舊」〔隱藏〕、「30651 嵐山」
 *   163483 → 「163483 丹後鉄道」〔隱藏〕、「163483丹後鉄道 不使用」〔隱藏〕
 *
 * 原本取「第一個開頭符合的」→ 抓到舊表，團號／車輛／導遊全讀不到，
 * 卻報成「大表沒寫導遊」（2026-08-15 Ina 指出 30651 才發現）。
 *
 * 用排序而不是過濾——**隱藏不等於作廢**（實測有隱藏分頁裡仍有團），
 * 所以隱藏只是往後排，最終還是由「哪一張真的有這天的團號列」決定。
 * 兩張都有這天的團時不猜：交給上層講出來請人確認，猜錯會讓名單少一半人。
 */
const ARCHIVE_RE = /舊|old|不使用|勿用|停用|異動|備份|作廢/i;

export function rankProductTabs(
  tabs: { title: string; hidden?: boolean }[], productNo: string,
): string[] {
  return tabs
    .filter((t) => t.title.trim().startsWith(productNo))
    .map((t) => ({
      title: t.title,
      // 分數越小越優先：現行且名字乾淨的排最前
      score: (t.hidden ? 2 : 0) + (ARCHIVE_RE.test(t.title) ? 1 : 0),
    }))
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .map((t) => t.title);
}


/** Sheets API 的合併範圍（半開區間，跟 API 一致）。 */
export type MergeRange = {
  startRowIndex?: number | null; endRowIndex?: number | null;
  startColumnIndex?: number | null; endColumnIndex?: number | null;
};

/**
 * 把合併儲存格的值攤平到整個範圍。
 *
 * 為什麼一定要做：大表大量使用**垂直合併**（39100 那個分頁就有 4599 組）。
 * 一個團佔三列、司機資訊寫在合併格裡時，Sheets API **只在第一列回傳值**，
 * 其餘兩列是空字串。程式如果剛好對到後面那列，就會判成「這格沒填」——
 * 明明人在畫面上看得清清楚楚（Ina 2026-08-17：「大表是把它 merge 了」）。
 *
 * 這是靜默錯誤：不會報錯，只會少一筆資料，然後變成一則假的催辦訊息。
 */
export function fillMerged(rows: string[][], merges: MergeRange[], exceptColumns: number[] = []): string[][] {
  /**
   * ⚠️ **團號欄一定要排除**。一個團常佔三列、團號寫在合併格裡，
   * 攤平之後三列都有團號 → findBuckets 會認成三台車，人數也變三倍
   * （2026-08-17 實測 528834 變成「3 台車 75 人」）。
   * 團號是「這是哪一團」的鍵值，合併只是排版；其他欄才是這一團的屬性。
   */
  const skip = new Set(exceptColumns.filter((c) => c >= 0));
  const out = rows.map((r) => [...(r ?? [])]);
  for (const m of merges ?? []) {
    const r0 = m.startRowIndex ?? 0, r1 = m.endRowIndex ?? 0;
    const c0 = m.startColumnIndex ?? 0, c1 = m.endColumnIndex ?? 0;
    const v = out[r0]?.[c0];
    if (v == null || String(v).trim() === "") continue;
    for (let r = r0; r < r1; r++) {
      if (!out[r]) out[r] = [];
      for (let c = c0; c < c1; c++) if (!skip.has(c) && !String(out[r][c] ?? "").trim()) out[r][c] = v;
    }
  }
  return out;
}
