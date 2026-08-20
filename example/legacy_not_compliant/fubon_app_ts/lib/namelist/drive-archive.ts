/**
 * 寄出去的名單存底 ＋ 寄送台帳，都放共用雲端硬碟。
 *
 * 為什麼要存底（Ina 2026-08-15）：導遊或車公司說「名單不對／沒收到」時，
 * 要拿得出**當時那封信附的到底是哪一份**。DAP 那張 Connected Sheet 每天被覆蓋，
 * 事後重產只會得到今天的資料，證明不了昨天寄了什麼。
 *
 * 為什麼台帳也要搬上來：原本是本機一個 .guide-mail-sent.json。
 * 檔案沒了、或換一台機器跑，程式會以為從來沒寄過而**重寄一次**——
 * 導遊被同一份名單打擾兩次。台帳是「別再寄一次」的唯一依據，不能只活在某台筆電上。
 *
 * ⚠️ 存底含個資（姓名／生日／電話／通訊帳號）。資料夾權限要收好，
 *    共用硬碟成員＝看得到全部名單，加人前先想清楚。
 */
import { createHash } from "node:crypto";
import { google } from "googleapis";
import { getGoogleAuth } from "../insurance/google-auth.ts";

/** 共用雲端硬碟 ID；沒設就代表這台機器不做存底（會在上層講出來，不是安靜跳過）。 */
export const ARCHIVE_DRIVE_ID = (process.env.NAMELIST_ARCHIVE_DRIVE_ID ?? "").trim();
const ROOT_NAME = "導遊名單存檔";
const LEDGER_NAME = "寄送台帳.json";

async function drive() {
  const auth = await getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

const esc = (s: string) => s.replace(/'/g, "\\'");

/** 找不到就建；同名只認第一個。共用硬碟一定要帶 supportsAllDrives，否則 404。 */
async function folder(name: string, parent: string): Promise<string> {
  const d = await drive();
  const q = `name='${esc(name)}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await d.files.list({
    q, fields: "files(id)", supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives",
  });
  if (found.data.files?.length) return found.data.files[0].id!;
  const made = await d.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] },
    fields: "id", supportsAllDrives: true,
  });
  return made.data.id!;
}

/**
 * 那天的資料夾在哪、叫什麼——講給人看的。
 *
 * Slack 上只寫「Drive 資料夾」等於沒說：這個帳號裡有幾十個共用硬碟，
 * 收訊息的人點進去之前不知道會看到什麼，也不知道自己有沒有權限。
 * 所以連結要附上**共用硬碟名稱＋完整路徑**（Ina 2026-08-17）。
 */
export async function dayFolderInfo(date: string): Promise<{ url: string; path: string }> {
  const id = await dayFolder(date);
  let driveName = "共用雲端硬碟";
  try {
    const d = await drive();
    const info = await d.drives.get({ driveId: ARCHIVE_DRIVE_ID, fields: "name" });
    if (info.data.name) driveName = info.data.name;
  } catch { /* 取不到名字不值得讓整支掛掉，退回通稱 */ }
  return {
    url: `https://drive.google.com/drive/folders/${id}`,
    path: `共用雲端硬碟「${driveName}」／${ROOT_NAME}／${date}`,
  };
}

/** 導遊名單存檔/出發日 資料夾。 */
export async function dayFolder(date: string): Promise<string> {
  const root = await folder(ROOT_NAME, ARCHIVE_DRIVE_ID);
  return folder(date, root);
}

/**
 * 上傳一份存底。**同名不覆蓋，改成加序號**——存底的意義是「當時寄的是這一份」，
 * 補寄第二版時兩份都要留得住，覆蓋掉等於銷毀證據。
 */
export async function archivePdf(
  folderId: string, filename: string, body: Buffer, contentKey?: string,
): Promise<string> {
  const d = await drive();
  const exists = await d.files.list({
    q: `'${folderId}' in parents and trashed=false and name contains '${esc(filename.replace(/\.pdf$/, ""))}'`,
    fields: "files(name,webViewLink,appProperties)", supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives",
  });
  /**
   * 內容一樣就沿用舊的那份，不再存一版。
   * 一天會跑很多輪（12:00／16:00／17:00，還有重跑），每輪都存的話資料夾裡會塞滿
   * 「第 2 版、第 3 版…」但內容全同的檔，真正的更新版反而找不到。
   *
   * ⚠️ 比對的是**呼叫端給的 contentKey（名單 HTML 的雜湊）不是 PDF 的 md5**：
   * Playwright 每次列印都會把當下時間寫進 PDF，內容完全沒變位元組也會不一樣，
   * 拿 md5 比永遠比不中（2026-08-17 實測）。
   */
  const key = contentKey ? createHash("sha256").update(contentKey).digest("hex").slice(0, 32) : "";
  const same = key ? exists.data.files?.find((f) => f.appProperties?.contentKey === key) : undefined;
  if (same?.webViewLink) return same.webViewLink;
  const n = exists.data.files?.length ?? 0;
  const name = n === 0 ? filename : filename.replace(/\.pdf$/, `_第${n + 1}版.pdf`);
  const res = await d.files.create({
    requestBody: { name, parents: [folderId], ...(key ? { appProperties: { contentKey: key } } : {}) },
    media: { mimeType: "application/pdf", body: (await import("node:stream")).Readable.from(body) },
    fields: "id,webViewLink", supportsAllDrives: true,
  });
  return res.data.webViewLink ?? res.data.id!;
}

/** 台帳檔案 ID（沒有就建一個空的）。 */
async function ledgerFile(): Promise<string> {
  const d = await drive();
  const root = await folder(ROOT_NAME, ARCHIVE_DRIVE_ID);
  const found = await d.files.list({
    q: `name='${LEDGER_NAME}' and '${root}' in parents and trashed=false`,
    fields: "files(id)", supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives",
  });
  if (found.data.files?.length) return found.data.files[0].id!;
  const made = await d.files.create({
    requestBody: { name: LEDGER_NAME, parents: [root] },
    media: { mimeType: "application/json", body: "[]" },
    fields: "id", supportsAllDrives: true,
  });
  return made.data.id!;
}

export async function readLedger(): Promise<unknown[]> {
  const d = await drive();
  const id = await ledgerFile();
  const res = await d.files.get({ fileId: id, alt: "media", supportsAllDrives: true }, { responseType: "text" });
  try {
    return JSON.parse(String(res.data ?? "[]"));
  } catch {
    // 讀不出來時**不能當成空的**——那會讓今天寄過的全部再寄一次
    throw new Error("共用硬碟上的寄送台帳讀不出來（內容不是合法 JSON）→ 已中止，避免重複寄信。");
  }
}

export async function writeLedger(rows: unknown[]): Promise<void> {
  const d = await drive();
  const id = await ledgerFile();
  await d.files.update({
    fileId: id, media: { mimeType: "application/json", body: JSON.stringify(rows, null, 2) },
    supportsAllDrives: true,
  });
}
