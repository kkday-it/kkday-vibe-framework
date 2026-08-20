/**
 * 訊息尾巴那排連結——**一份實作，四則訊息共用**。
 *
 * 為什麼抽出來（2026-08-20）：原本只有 make-guide-package 有這幾個連結，
 * 於是 12:00 那則有「出團前檢查・執行紀錄・車公司回報」，18:10 的看門狗一條都沒有——
 * 而看門狗那則正是最需要點進去查的一則（Ina 問「這個下面可以加上連結嗎」）。
 * 各寫一份的話，加了一個連結就只有其中一則會有，這種分岔今天已經發生兩次。
 */
export type Link = { label: string; url: string };

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id.trim()}`;

/**
 * 執行紀錄與車公司回報。沒設對應的 ID 就不放那一條——
 * 放一個點不開的連結比沒有連結更糟。
 */
export function sourceLinks(env = process.env): Link[] {
  const audit = (env.JP_AUDIT_SHEET_ID ?? "").trim();
  const portal = (env.PORTAL_SHEET_ID ?? "").trim();
  return [
    ...(audit ? [{ label: "執行紀錄", url: sheetUrl(audit) }] : []),
    ...(portal ? [{ label: "車公司回報", url: sheetUrl(portal) }] : []),
  ];
}

/**
 * 「出團前檢查」那張核對表。直接連到那個分頁（#gid），不是連到整份試算表——
 * AM 工作台有兩頁，落在錯的那頁還要自己找。
 *
 * gid 要問 Sheets API，所以這支是 async；問不到就退回整份的網址，不要因此少一條連結。
 */
export async function preflightLink(
  sheets: { spreadsheets: { get: (p: any) => Promise<any> } }, env = process.env,
): Promise<Link[]> {
  const id = (env.AM_SHEET_ID ?? "").trim();
  if (!id) return [];
  const url = sheetUrl(id);
  const label = "出團前檢查（車公司回報了沒）";
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties" });
    const gid = meta.data.sheets?.find((x: any) => x.properties?.title === "出團前檢查")?.properties?.sheetId;
    return [{ label, url: gid == null ? url : `${url}#gid=${gid}` }];
  } catch {
    return [{ label, url }];
  }
}
