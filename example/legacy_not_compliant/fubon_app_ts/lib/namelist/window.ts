/**
 * 「現在該看哪幾天」的日期視窗。
 *
 * 抽出來成一個純函式，是因為它**只在半夜自己改變**：所有人工驗證都在同一天內做完，
 * 跨日那條路從來沒被走過，而它出錯的樣子是「早上打開就是一張錯的表」——
 * 沒有錯誤訊息，也沒有人會知道原因。純函式才測得到跨月、跨年。
 *
 * 一律用 Asia/Tokyo：團是日本的團，容器的 TZ 可能被平台改掉，不能靠它。
 * （日本沒有日光節約時間，所以「加 24 小時」等於「加一天」，這裡才敢這樣算。）
 */
export function windowDays(now: Date = new Date(), days = 3): string[] {
  const out: string[] = [];
  for (let n = 0; n < days; n++) {
    out.push(new Date(now.getTime() + n * 86_400_000)
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));   // sv-SE 就是 YYYY-MM-DD
  }
  return out;
}

/**
 * 今天出團的那幾列要不要收起來。
 *
 * 06:00 這條界線沿用「司導資訊一路追到出團當天 06:00」那條政策：在那之前今天的團
 * 還救得回來，之後就只是佔版面。**收起來不等於刪掉**——資料留在表上，展開就看得到。
 */
export function shouldHideToday(now: Date = new Date()): boolean {
  const h = Number(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }));
  return h >= 6;
}
