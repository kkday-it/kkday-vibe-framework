// 透過 KeyCloak（以 Google 為 Identity Provider）取得可呼叫 Google API 的 access token。
// 依 MIS 提供的三步：
//   1. client_credentials：APP 用自身 client_id+secret 取得 KeyCloak token
//   2. token-exchange：切換身份成 TARGET_BOT_USER（無需密碼）
//   3. broker/{idp}/token：提領該身份的 Google access token
// 需 env：KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, KEYCLOAK_SECRET,
//        KEYCLOAK_TARGET_BOT_USER, KEYCLOAK_IDP_ALIAS
//
// 注意：Google access token 只活 ~1 小時；每次要用就重取（本模組每次呼叫都跑完整三步）。

type Env = NodeJS.ProcessEnv;

function need(env: Env, k: string): string {
  const v = env[k];
  if (!v) throw new Error(`缺少環境變數 ${k}`);
  return v;
}

async function postForm(url: string, form: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* 保留 text */ }
  if (!res.ok) throw new Error(`${url} → ${res.status} ${json.error || ""} ${json.error_description || text.slice(0, 200)}`);
  return json;
}

/** 跑完整三步，回傳可呼叫 Google API 的 access token。失敗即拋錯。 */
export async function getGoogleAccessTokenViaKeycloak(env: Env = process.env): Promise<string> {
  const base = need(env, "KEYCLOAK_BASE_URL").replace(/\/+$/, ""), realm = need(env, "KEYCLOAK_REALM"); // 去掉結尾斜線避免 //realms
  const cid = need(env, "KEYCLOAK_CLIENT_ID"), secret = need(env, "KEYCLOAK_SECRET");
  const target = need(env, "KEYCLOAK_TARGET_BOT_USER"), idp = need(env, "KEYCLOAK_IDP_ALIAS");
  const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;

  // 1. APP 自身 token
  const j1 = await postForm(tokenUrl, { grant_type: "client_credentials", client_id: cid, client_secret: secret });
  if (!j1.access_token) throw new Error("步驟1 client_credentials 未取得 token");

  // 2. token-exchange 切換身份成 target 使用者
  const j2 = await postForm(tokenUrl, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: cid, client_secret: secret,
    subject_token: j1.access_token,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    requested_subject: target,
    audience: cid,
  });
  if (!j2.access_token) throw new Error("步驟2 token-exchange 未取得 token");

  // 3. 提領 Google access token
  const r3 = await fetch(`${base}/realms/${realm}/broker/${idp}/token`, {
    headers: { Authorization: `Bearer ${j2.access_token}` },
  });
  const body = await r3.text();
  let gtok = "";
  try { gtok = JSON.parse(body).access_token; } catch { gtok = new URLSearchParams(body).get("access_token") || ""; }
  if (!gtok) throw new Error(`步驟3 broker/${idp}/token 未取得 Google token：${r3.status} ${body.slice(0, 200)}`);
  return gtok;
}

/** 以現成 Google access token 建立 googleapis 可用的 auth（供 Gmail/Drive/Sheets）。 */
export async function googleAuthFromAccessToken(accessToken: string) {
  const { google } = await import("googleapis");
  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: accessToken });
  return client;
}

/** 是否已配置 KeyCloak（決定要不要走這條）。 */
export function keycloakConfigured(env: Env = process.env): boolean {
  return Boolean(env.KEYCLOAK_BASE_URL && env.KEYCLOAK_CLIENT_ID && env.KEYCLOAK_SECRET && env.KEYCLOAK_IDP_ALIAS);
}
