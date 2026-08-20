// 共用 Google 授權解析:優先 OAuth(credentials.json+token.json,與抓信同一組),
// 否則用服務帳號(GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY_B64)。
// Sheets/Drive 都能用;Gmail 讀信只能 OAuth(見 gmail-fetch)。

/** 回傳可傳給 googleapis 的 auth 物件。scopes 僅服務帳號需要。 */
export async function getGoogleAuth(scopes: string[], env: NodeJS.ProcessEnv = process.env) {
  const { existsSync } = await import("node:fs");
  if (existsSync("credentials.json") && existsSync("token.json")) {
    const { getOAuth2Client } = await import("./gmail-fetch.ts");
    return getOAuth2Client(env);
  }
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyB64 = env.GOOGLE_PRIVATE_KEY_B64;
  if (!email || !keyB64) {
    throw new Error("缺少 Google 授權:需 OAuth(credentials.json+token.json)或 GOOGLE_SERVICE_ACCOUNT_EMAIL+GOOGLE_PRIVATE_KEY_B64");
  }
  const { google } = await import("googleapis");
  const key = Buffer.from(keyB64, "base64").toString("utf-8");
  return new google.auth.JWT({ email, key, scopes });
}
