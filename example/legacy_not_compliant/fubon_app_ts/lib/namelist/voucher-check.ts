/**
 * 從客人收到的**憑證信附件**確認司導資訊真的傳出去了（Ina 2026-08-16）。
 *
 * 為什麼需要：SCM 回 `result_code: 0000` 只代表「後端收下了」，不代表客人看得到。
 * 而客人在**訂單明細頁看不到電話**（要等體驗日當天才顯示，2024 年深夜擾民事件之後
 * 刻意改的）——所以拿明細頁去驗會誤判成失敗，然後重送，客人又被通知一次。
 * **憑證是唯一會立刻反映的地方**，要驗就驗這裡。見 [[project_scm_phone_display_delay]]。
 *
 * 授權走 KeyCloak（跟富邦讀名單信、SCM 讀驗證碼同一條），**不動寄信那組 token**：
 * 那組刻意只有 gmail.send，放大成可讀整個信箱的風險不成比例（見 gmail-oauth-setup.ts 檔頭）。
 */
import { inflateSync } from "node:zlib";
import { getGoogleAccessTokenViaKeycloak } from "../insurance/keycloak-google.ts";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** 憑證信：KKday 系統寄的、主旨帶訂單編號。只認這個寄件人，不亂抓信。 */
export const voucherQuery = (orderMid: string) =>
  `from:no-reply@kkday.com ${orderMid} has:attachment`;

export type VoucherHit = {
  messageId: string;
  /** 信件寄達時間 */
  receivedAt: Date;
  filename: string;
  pdf: Buffer;
};

const b64 = (s: string) => Buffer.from(String(s ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** 遞迴找出第一個 PDF 附件（憑證信只有一個）。 */
function findPdf(part: any): any {
  if (part?.filename?.toLowerCase().endsWith(".pdf")) return part;
  for (const p of part?.parts ?? []) {
    const hit = findPdf(p);
    if (hit) return hit;
  }
  return null;
}

/**
 * 抓這張訂單**最新一封**憑證的 PDF。
 *
 * `notBefore` 用來排除舊憑證：寫進 SCM 之前就存在的那封，內容當然是舊的，
 * 拿它來驗會永遠「驗不過」或「假通過」。找不到就回 null——
 * 呼叫端要當成「還沒收到」去重試，不要當成失敗。
 */
export async function fetchVoucherPdf(
  orderMid: string, notBefore?: Date, env = process.env,
): Promise<VoucherHit | null> {
  const tok = await getGoogleAccessTokenViaKeycloak(env);
  const api = async (u: string) => {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`Gmail API ${r.status}：${(await r.text()).slice(0, 200)}`);
    return r.json() as any;
  };
  const list = await api(`${API}/messages?q=${encodeURIComponent(voucherQuery(orderMid))}&maxResults=10`);
  for (const m of list.messages ?? []) {
    const d = await api(`${API}/messages/${m.id}?format=full`);
    const receivedAt = new Date(Number(d.internalDate));
    if (notBefore && receivedAt < notBefore) continue;
    const part = findPdf(d.payload);
    if (!part?.body?.attachmentId) continue;
    const a = await api(`${API}/messages/${m.id}/attachments/${part.body.attachmentId}`);
    return { messageId: m.id, receivedAt, filename: part.filename, pdf: b64(a.data) };
  }
  return null;
}

/**
 * 從 PDF 位元組裡撈出可讀文字。
 *
 * ⚠️ **目前抽不出中文**（2026-08-16 實測 26KK219334778）。流程走得通：
 * Flate 解得開、找得到 2628 個 Tj，但文字是 `<0001> Tj` 這種**字型內部編號**，
 * 要先讀該字型的 ToUnicode 對照表才還原得回中文，而一份憑證有多個字型子集，
 * 各有各的編號——不能把所有對照表合成一份（會互相蓋掉，數字尤其容易錯）。
 *
 * 所以現在抽到的是空字串，`verifyVoucher` 會回 **「讀不出內容」**。
 * 這跟「內容裡找不到」是**兩件不同的事**，刻意分開：前者是我們的工具還沒做完，
 * 後者才代表真的沒寫進去。混在一起會讓人對著沒問題的東西查半天。
 *
 * 要做完的話：解析每個字型物件的 /ToUnicode 串流（beginbfchar／beginbfrange），
 * 追蹤內容流裡的 `/Fnn Tf` 切換目前字型，再逐段還原。約半天工。
 */
export function pdfText(pdf: Buffer): string {
  // 憑證的內容流是 FlateDecode 壓縮的，不解壓什麼都抽不到（2026-08-16 實測）。
  // 逐段 inflate，失敗的段落跳過——PDF 裡也有圖片等非文字流，那些本來就解不出字。
  const chunks: string[] = [pdf.toString("latin1")];
  let at = 0;
  while (true) {
    const beg = pdf.indexOf("stream", at);
    if (beg < 0) break;
    let s0 = beg + 6;
    if (pdf[s0] === 0x0d) s0++;
    if (pdf[s0] === 0x0a) s0++;
    const end = pdf.indexOf("endstream", s0);
    if (end < 0) break;
    try { chunks.push(inflateSync(pdf.subarray(s0, end)).toString("latin1")); } catch { /* 非文字流，跳過 */ }
    at = end + 9;
  }
  const raw = chunks.join("\n");
  const out: string[] = [];
  // PDF 內容流裡的可見文字放在 (…) Tj / TJ 陣列裡
  for (const m of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*T[Jj]/g)) out.push(m[1]);
  // UTF-16BE 十六進位字串 <0041...>：中日文憑證多半走這種
  for (const m of raw.matchAll(/<([0-9A-Fa-f]{8,})>\s*T[Jj]/g)) {
    const hex = m[1].replace(/\s/g, "");
    let s = "";
    for (let i = 0; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    out.push(s);
  }
  return out.join("").replace(/\\([()\\])/g, "$1");
}

export type VoucherVerdict =
  | { ok: true; found: string[]; receivedAt: Date }
  | { ok: false; reason: "沒有憑證" | "讀不出內容" | "內容裡找不到"; missing?: string[]; receivedAt?: Date };

/**
 * 憑證裡有沒有這些字（司導姓名、電話…）。
 *
 * 三種「不 ok」刻意分開：**沒收到信**、**PDF 讀不出來**、**讀得出來但沒有那些字**——
 * 只有第三種才代表真的沒寫進去。混在一起會讓人對著沒問題的東西查半天。
 */
export async function verifyVoucher(
  orderMid: string, expect: string[], notBefore?: Date, env = process.env,
): Promise<VoucherVerdict> {
  const hit = await fetchVoucherPdf(orderMid, notBefore, env);
  if (!hit) return { ok: false, reason: "沒有憑證" };
  const text = pdfText(hit.pdf);
  if (!text.trim()) return { ok: false, reason: "讀不出內容", receivedAt: hit.receivedAt };
  const want = expect.map((x) => x.trim()).filter(Boolean);
  const norm = (s: string) => s.replace(/[\s　-]/g, "");
  const missing = want.filter((w) => !norm(text).includes(norm(w)));
  return missing.length
    ? { ok: false, reason: "內容裡找不到", missing, receivedAt: hit.receivedAt }
    : { ok: true, found: want, receivedAt: hit.receivedAt };
}
