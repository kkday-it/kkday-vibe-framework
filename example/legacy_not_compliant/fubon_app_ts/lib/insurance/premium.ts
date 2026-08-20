// 從富邦頁面文字擷取保費（如「保險費 864.0元(每人保費32.0元)」）。
// ⚠️ 金額含小數點（864.0元），字元集必須含 '.'，否則會抓空（2026-07-29 雲端漏保費真因）。
// 注意：複核頁的擷取跑在 page.evaluate（瀏覽器）內，無法 import 本函式，
//       那裡以「相同的字面 regex」內聯；本檔為 Node 端備援與回歸測試的單一真相。
export const PREMIUM_RE = /保險費([\d,.]+元(?:[（(][^）)]*[）)])?)/;

/** 從一段（含空白的）頁面文字擷取保費字串；抓不到回空字串。 */
export function parsePremium(text: string): string {
  const m = (text || "").replace(/\s+/g, "").match(PREMIUM_RE);
  return m ? m[1] : "";
}
