// 把保單/證明書 PDF 上傳到 Google Drive（共用雲端硬碟）。
// 授權:OAuth 或服務帳號皆可（見 google-auth）。服務帳號只能傳「共用雲端硬碟」(無配額問題)。
// 需環境變數 FUBON_CERT_DRIVE_FOLDER_ID（共用雲端硬碟 ID 或其下資料夾 ID）。
// 依出團日自動建「月份/日期」子資料夾:如 2026-07/2026-07-29/。

import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { getGoogleAuth } from "./google-auth.ts";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export interface DriveUploadResult {
  id: string;
  name: string;
  webViewLink?: string;
}

/** 在 parent 下找同名資料夾,沒有就建。回傳資料夾 ID。（相容共用雲端硬碟） */
async function ensureFolder(drive: any, parentId: string, name: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const list = await drive.files.list({
    q, fields: "files(id,name)", supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  if (list.data.files?.length) return list.data.files[0].id;
  const made = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id", supportsAllDrives: true,
  });
  return made.data.id;
}

/**
 * 上傳檔案到 Drive。subPath 會逐層 find-or-create（如 ["2026-07","2026-07-29"]）。
 * dryRun 或未設 folderId 時只印不傳,回傳 null。
 */
export async function uploadToDrive(
  localPath: string,
  opts: { folderId?: string; subPath?: string[]; name?: string; dryRun?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<DriveUploadResult | null> {
  const env = opts.env ?? process.env;
  const rootId = opts.folderId || env.FUBON_CERT_DRIVE_FOLDER_ID;
  const name = opts.name || basename(localPath);
  if (!rootId) { console.log("（未設 FUBON_CERT_DRIVE_FOLDER_ID，略過 Drive 上傳）"); return null; }
  if (opts.dryRun) {
    console.log(`【dry-run】Drive 未上傳：${(opts.subPath ?? []).join("/")}/${name}`);
    return null;
  }
  const { google } = await import("googleapis");
  const auth = await getGoogleAuth(DRIVE_SCOPES, env);
  const drive = google.drive({ version: "v3", auth: auth as any });

  // 逐層建立月份/日期子資料夾
  let parent = rootId;
  for (const seg of opts.subPath ?? []) parent = await ensureFolder(drive, parent, seg);

  const res = await drive.files.create({
    requestBody: { name, parents: [parent] },
    media: { mimeType: "application/pdf", body: createReadStream(localPath) },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });
  const out: DriveUploadResult = {
    id: res.data.id ?? "", name: res.data.name ?? name, webViewLink: res.data.webViewLink ?? undefined,
  };
  console.log(`☁️ 已上傳 Drive：${(opts.subPath ?? []).join("/")}/${out.name}`);
  return out;
}

/** 出團日(YYYY-MM-DD)→ 月份/日期子資料夾路徑 ["YYYY-MM","YYYY-MM-DD"]。 */
export function monthDateSubPath(departureDate: string): string[] {
  const m = (departureDate ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return [];
  return [`${m[1]}-${m[2]}`, `${m[1]}-${m[2]}-${m[3]}`];
}
