/**
 * 「重寄申請」分頁：AM 發現名單有錯、改完來源之後，在這裡登記要重寄哪一團。
 *
 * 為什麼需要（Ina 2026-08-15）：
 * 16:00 那一輪之後就不再自動寄任何東西了。這之後導遊才回報名單有錯的話，
 * AM 手上沒有任何可以按的東西——產名單那支跑在開發機上，AM 碰不到。
 *
 * 為什麼不放在「回報狀況」那一頁：那頁每小時被整頁重畫，勾選會被洗掉，
 * 而且洗掉不會有任何跡象——AM 會以為登記了，其實沒有。
 *
 * 為什麼是**申請**而不是直接觸發：這支程式不是隨時在跑，登記完要等下一次執行。
 * 所以狀態欄一定要誠實反映「還沒處理」，不能讓 AM 以為按了就寄出去了。
 *
 * ⚠️ 重寄會**跳過「寄過就不再寄」的台帳**——那正是重點（本來就是要再寄一次）。
 *    所以一列只處理一次：處理完立刻寫回「已重寄＋時間」，避免每次執行都重寄一輪。
 */
export const RESEND_TAB = "重寄申請";

// 欄序：AM 要填的在前，程式在寫的在後（Ina 2026-08-15）。狀態／處理時間固定在 E/F，
// 寄信那支用固定範圍寫回。解析一律用標題文字找欄，不靠順序。
export const RESEND_HEADERS = ["出團日", "團號", "重寄什麼", "原因", "申請時間", "狀態", "處理時間"] as const;

/**
 * 「重寄什麼」的選項（Ina 2026-08-16）。下拉、不能打字。
 *
 * ⚠️ 只有做得到的事才給「可以選又會發生」的待遇。SCM 那條線還沒接上自動化
 * （卡在登入的二次驗證），所以標「尚未開通」——**選了會被明確拒絕**，
 * 不會安靜躺在那裡讓 AM 以為登記好了。
 */
export const RESEND_KINDS = {
  GUIDE: "名單給導遊",
  FNL: "FNL 給京馬車＆保津川",
  SCM: "SCM 回報司導給客人（尚未開通）",
} as const;
export type ResendKind = keyof typeof RESEND_KINDS;

export const RESEND_KIND_LIST = Object.values(RESEND_KINDS);

/** 還沒開通的項目，處理時直接寫回這句。 */
export const NOT_ENABLED = "這項還沒開通，請直接找 Klo";

/**
 * 認出這一列要重寄什麼。**空白一律當「名單給導遊」**——
 * 這欄是 2026-08-16 才加的，舊資料沒有值，不能因此變成無效申請。
 */
export function kindOf(cellText: unknown): ResendKind {
  const v = String(cellText ?? "").trim();
  if (!v) return "GUIDE";
  if (/FNL|京馬車|保津川|供應商/i.test(v)) return "FNL";
  if (/SCM|司導|行前提醒/i.test(v)) return "SCM";
  return "GUIDE";
}

/**
 * 「狀態」與「處理時間」兩欄的 A1 範圍（例 `F12:G12`）。
 *
 * ⚠️ **不要寫死 `E:F`。** 2026-08-16 加了「重寄什麼」欄之後整排右移，
 * 原本寫死 E:F 的寫回會蓋掉「申請時間」——而且不會有任何錯誤訊息。
 * 從 RESEND_HEADERS 算，欄序再變一次也不用改這裡。
 */
export function statusRangeA1(row: number): string {
  const i = RESEND_HEADERS.indexOf("狀態" as never);
  const col = String.fromCharCode(65 + i);
  const col2 = String.fromCharCode(65 + i + 1);   // 處理時間就在它右邊
  return `${col}${row}:${col2}${row}`;
}

/** 找不到對應團號時寫回狀態欄的字。刻意不是「失敗」——AM 要知道是**對不到**，不是系統壞了。 */
export const NOT_FOUND = "找不到這團";

export type ResendRequest = {
  /** 試算表上的列號（1-based），處理完要寫回同一列 */
  row: number;
  date: string;
  tourCode: string;
  reason: string;
  done: boolean;
  /** 要重寄什麼。舊資料沒有這欄 → 當成名單給導遊。 */
  kind: ResendKind;
};

/**
 * 團號正規化。
 *
 * 下拉選單的值長這樣：「KK260816-39100　積丹半島一日遊」——帶商品名是為了讓 AM 認得出
 * 是哪一團（光看團號認不出來）。程式只要前面那段，所以**先切掉第一個空白之後的東西**，
 * 再去掉剩餘空白轉大寫。順序不能反：先去空白的話兩段會黏成一個字串，永遠對不到。
 */
const norm = (s: unknown) =>
  String(s ?? "").trim().split(/[\s　]+/)[0].replace(/[\s　]/g, "").toUpperCase();

/**
 * 「已處理」以外都當成待處理——狀態欄空白、亂填、或寫「待處理」都要處理到。
 *
 * 「找不到這團」也算已處理：否則每小時都會重試同一列、每小時 tag 一次 Klo & Winnie，
 * 三天後沒人會再看那個頻道。AM 改好團號（或清掉狀態欄）就會再被撿起來。
 */
const isDone = (s: unknown) => /已重寄|完成|done|找不到|還沒開通/i.test(String(s ?? ""));

/**
 * 解析整個分頁。找不到欄位就**丟出例外**，不要安靜回空陣列——
 * 「沒有人申請」與「欄位改名所以讀不到」長得一模一樣，後者會讓申請石沉大海。
 */
export function parseResendRequests(rows: string[][]): ResendRequest[] {
  if (!rows.length) return [];
  const hdr = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const at = (re: RegExp) => hdr.findIndex((c) => re.test(c));
  const cDate = at(/出團日|出発日|日期/), cTour = at(/團號|ツアー番号/), cReason = at(/原因|理由|說明/),
    cStatus = at(/狀態|状態|status/i), cKind = at(/重寄什麼|重寄項目|種類/);
  if (cDate < 0 || cTour < 0) {
    throw new Error(`「${RESEND_TAB}」找不到出團日或團號欄（標題列：${hdr.join(" | ")}）→ 已中止，避免漏掉重寄申請`);
  }
  const out: ResendRequest[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const tourCode = norm(r[cTour]);
    if (!tourCode) continue;
    out.push({
      row: i + 1,
      date: String(r[cDate] ?? "").trim().slice(0, 10),
      tourCode,
      reason: cReason >= 0 ? String(r[cReason] ?? "").trim() : "",
      done: cStatus >= 0 ? isDone(r[cStatus]) : false,
      kind: kindOf(cKind >= 0 ? r[cKind] : ""),
    });
  }
  return out;
}

/** 這天有哪些團被要求重寄（只回還沒處理的）。可再指定要哪一種。 */
export function pendingFor(reqs: ResendRequest[], date: string, kind?: ResendKind): ResendRequest[] {
  return reqs.filter((r) => !r.done && r.date === date && (kind ? r.kind === kind : true));
}

/** 這一團在不在待重寄清單裡。團號比對一律去空白轉大寫。 */
export function isRequested(
  reqs: ResendRequest[], date: string, tourCode: string, kind: ResendKind = "GUIDE",
): ResendRequest | undefined {
  return pendingFor(reqs, date, kind).find((r) => r.tourCode === norm(tourCode));
}
