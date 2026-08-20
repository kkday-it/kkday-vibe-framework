/**
 * 自動取得 SCM 登入的 email 驗證碼（6 位數）。
 *
 * 授權沿用富邦那條線：Keycloak → Google access token（TARGET_BOT_USER 就是 Ina 本人），
 * 所以**不需要另外做 OAuth 同意**，也不必把 token.json 放在硬碟上。
 *
 * 三個安全要求：
 *  1. 只認 SCM 系統寄的那封（寄件人 + 主旨都要對），不亂抓信裡的六位數字。
 *  2. **只收「這次登入之後」才寄達的信** —— 舊碼可能還沒過期，用了會登入失敗又說不出原因。
 *  3. 驗證碼不寫檔、不進 log（只回傳給呼叫端用一次）。
 *
 * ⚠️ **一定要 includeSpamTrash=true**（2026-08-17 查出來的）：Gmail 查詢預設不含垃圾桶，
 *    而驗證碼信是用過即丟的東西，Ina 看完就順手刪了 → 程式在等一封「已經到了但被刪掉」的信，
 *    等到逾時，錯誤訊息卻長得像「信還沒寄來」。這一天就是這樣白等的。
 *    信被刪掉不代表碼失效，Gmail 的 TRASH 只是一個標籤，內容照樣讀得到。
 */
import { getGoogleAccessTokenViaKeycloak } from "./keycloak-google.ts";

// 主旨 production 是「KKday 驗證碼」、stage 是「stageKKday 驗證碼」，用 subject:驗證碼 兩邊都涵蓋。
const QUERY = "from:no-reply@kkday.com subject:驗證碼 newer_than:1h";
/** 信件內文長這樣：「您登入的驗證碼為：036780」 */
const CODE_RE = /驗證碼為\s*[：:]\s*(\d{6})/;

const b64 = (s: string) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** 遞迴把 multipart 的所有文字片段拼起來（HTML 信的碼藏在 text/html 裡）。 */
function collectText(part: any): string {
  if (!part) return "";
  let out = part.body?.data ? b64(part.body.data) : "";
  for (const p of part.parts ?? []) out += "\n" + collectText(p);
  return out;
}

export type OtpResult = { code: string; receivedAt: Date };

/**
 * 抓最新一封、且比 notBefore 還新的驗證碼信。
 * 找不到回 null（呼叫端該重試或報錯，不要假裝成功）。
 */
export async function fetchScmOtp(notBefore: Date, env = process.env): Promise<OtpResult | null> {
  const tok = await getGoogleAccessTokenViaKeycloak(env);
  const api = async (u: string) => {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`Gmail API ${r.status}：${(await r.text()).slice(0, 200)}`);
    return r.json() as any;
  };
  const list = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(QUERY)}&includeSpamTrash=true&maxResults=5`);
  for (const m of list.messages ?? []) {
    const d = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`);
    const received = new Date(Number(d.internalDate));
    if (received < notBefore) continue;                 // 舊碼一律不用
    const hit = CODE_RE.exec(collectText(d.payload));
    if (hit) return { code: hit[1], receivedAt: received };
  }
  return null;
}

/** 等驗證碼寄到（SCM 寄信有延遲）。逾時回 null。 */
export async function waitForScmOtp(notBefore: Date, timeoutMs = 120_000, env = process.env): Promise<OtpResult | null> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetchScmOtp(notBefore, env);
      if (r) return r;
    } catch (e) {
      // ⚠️ 錯誤不能靜靜吞掉：吞掉的話「權杖失效」看起來會跟「信還沒到」一模一樣，查不出原因
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== lastErr) { lastErr = msg; console.log("  讀信出錯（會繼續重試）：" + msg.slice(0, 160)); }
    }
    await new Promise((s) => setTimeout(s, 5000));
  }
  if (lastErr) console.log("  最後一次錯誤：" + lastErr.slice(0, 200));
  return null;
}
