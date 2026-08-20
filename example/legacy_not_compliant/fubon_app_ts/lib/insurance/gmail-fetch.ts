// 自動抓 Data team 名單信的 CSV 附件（Gmail 讀取；沿用同 team movvbot 的 OAuth2 授權法）。
// 授權：GOOGLE_CLIENT_ID/SECRET（或 credentials.json）+ token.json（refresh，首次一次性同意產生）。
// 首次需跑 scripts/fubon-fetch-namelist.ts 完成瀏覽器授權。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TOKEN_PATH = join(process.cwd(), "token.json");
const CREDENTIALS_PATH = join(process.cwd(), "credentials.json");
// 同一組授權涵蓋：讀 Gmail（抓名單附件）+ 寫 Drive（上傳保單）+ 寫 Sheets（跑程記錄）。
// 改動 scope 後需重跑 --auth 重新同意，token.json 才會帶新權限。
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

/** 建 OAuth2 client：優先讀 credentials.json，否則用 GOOGLE_CLIENT_ID/SECRET（OOB）。 */
export async function getOAuth2Client(env = process.env) {
  const { google } = await import("googleapis");
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  let redirectUri = "urn:ietf:wg:oauth:2.0:oob";
  if (existsSync(CREDENTIALS_PATH)) {
    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
    const key = creds.installed || creds.web;
    clientId = key.client_id;
    clientSecret = key.client_secret;
    redirectUri = (key.redirect_uris && key.redirect_uris[0]) || redirectUri;
  } else {
    clientId = env.GOOGLE_CLIENT_ID;
    clientSecret = env.GOOGLE_CLIENT_SECRET;
  }
  if (!clientId || !clientSecret) {
    throw new Error("需要 credentials.json 或 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  }
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  if (existsSync(TOKEN_PATH)) {
    oAuth2Client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, "utf8")));
  }
  return oAuth2Client;
}

/** 產生首次授權 URL（給人在瀏覽器同意用）。 */
export async function makeAuthUrl(env = process.env): Promise<string> {
  const client = await getOAuth2Client(env);
  return client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
}

/** 用同意後拿到的 code 換 token 並存 token.json。 */
export async function saveTokenFromCode(code: string, env = process.env): Promise<void> {
  const client = await getOAuth2Client(env);
  const { tokens } = await client.getToken(code.trim());
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
}

export interface FetchedNamelist {
  messageId: string;
  threadId: string;
  subject: string;
  /** 原信 Message-ID 標頭，回覆 thread 用（In-Reply-To/References）。 */
  rfcMessageId: string;
  /** 下載的 CSV 附件路徑（可能多個）。 */
  csvPaths: string[];
}

/** 遞迴找有檔名的附件 part。 */
function collectAttachmentParts(part: any, out: any[] = []): any[] {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push(part);
  for (const p of part.parts || []) collectAttachmentParts(p, out);
  return out;
}

/**
 * 抓最新一封符合條件的 Data 名單信，下載其 CSV 附件到 outDir。
 * query 例：`from:data@kkday.com subject:"一日旅遊投保參考名單" newer_than:2d`
 */
export async function fetchLatestNamelist(
  query: string,
  outDir: string,
  env = process.env,
  authOverride?: unknown, // 傳入現成 auth（如 KeyCloak 取得的 Google token）則用它，否則用 OAuth 檔
): Promise<FetchedNamelist | null> {
  const { google } = await import("googleapis");
  const auth = authOverride ?? (await getOAuth2Client(env));
  const gmail = google.gmail({ version: "v1", auth: auth as any });

  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 5 });
  const msgs = list.data.messages || [];
  if (!msgs.length) return null;

  // 取最新（list 已按新到舊）
  const id = msgs[0].id!;
  const d = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = d.data.payload?.headers || [];
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
  const rfcMessageId = headers.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? "";

  const parts = collectAttachmentParts(d.data.payload);
  const csvPaths: string[] = [];
  for (const part of parts) {
    if (!/\.csv$/i.test(part.filename)) continue;
    const att = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: id,
      id: part.body.attachmentId,
    });
    const buf = Buffer.from(att.data.data ?? "", "base64url");
    const p = join(outDir, part.filename);
    writeFileSync(p, buf);
    csvPaths.push(p);
  }

  return { messageId: id, threadId: d.data.threadId ?? "", subject, rfcMessageId, csvPaths };
}
