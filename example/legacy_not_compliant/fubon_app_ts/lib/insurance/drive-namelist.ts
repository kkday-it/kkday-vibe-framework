// 從共用雲端硬碟「名單」資料夾讀最新的名單 CSV（服務帳號即可,免 Gmail OAuth）。
// 搭配 Apps Script:它用 Ina 的身分把 Data 信的 CSV 附件丟進這資料夾,這裡再讀。
// 需環境變數 FUBON_NAMELIST_DRIVE_FOLDER_ID（共用硬碟裡「名單」資料夾 ID）。

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGoogleAuth } from "./google-auth.ts";

export interface DriveNamelist {
  csvPath: string;
  name: string;
  fileId: string;
}

/**
 * 抓資料夾裡最新(createdTime 最新)的 CSV,下載到 outDir。無檔回 null。
 */
export async function fetchLatestNamelistFromDrive(
  folderId: string,
  outDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DriveNamelist | null> {
  const { google } = await import("googleapis");
  const auth = await getGoogleAuth(["https://www.googleapis.com/auth/drive"], env);
  const drive = google.drive({ version: "v3", auth: auth as any });

  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (name contains '.csv' or mimeType='text/csv')`,
    orderBy: "createdTime desc",
    pageSize: 5,
    fields: "files(id,name,createdTime)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const f = list.data.files?.[0];
  if (!f?.id) return null;

  const res = await drive.files.get(
    { fileId: f.id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const csvPath = join(outDir, f.name || "namelist.csv");
  writeFileSync(csvPath, Buffer.from(res.data as ArrayBuffer));
  return { csvPath, name: f.name || "namelist.csv", fileId: f.id };
}
