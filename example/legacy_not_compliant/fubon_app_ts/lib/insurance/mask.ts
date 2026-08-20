// 機密遮罩：任何要進 log / Sheet「錯誤」欄 / Slack 的字串，先過這裡，
// 把身分證號、護照號等個資遮掉，避免夾在例外訊息裡外洩。
// 只遮數字/證號本身，其餘字照留，方便還原問題。

// 台灣身分證：1 英文 + 9 數字（如 A123456789）→ A12****789
const ROC_ID = /\b([A-Za-z])(\d{2})\d{4}(\d{3})\b/g;
// 6~9 碼連續數字（護照/居留證/長數字）→ 保留頭尾各 2 碼
const LONG_DIGITS = /\b(\d{2})\d{2,5}(\d{2})\b/g;

/** 遮掉字串中的身分證號 / 護照號等個資。輸入非字串則原樣轉字串。 */
export function maskIds(input: unknown): string {
  const s = input == null ? "" : String(input);
  return s
    .replace(ROC_ID, (_m, a, b, c) => `${a}${b}****${c}`)
    .replace(LONG_DIGITS, (_m, a, b) => `${a}****${b}`);
}
