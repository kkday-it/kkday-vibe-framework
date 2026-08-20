// 投保完成後「自動回覆」Data team 名單信：中文簡潔內文 + 保單/名單 PDF 附件。
// 內文商品編號 = prod_oid + 中文品名（去重）；出團日 = lst_dt_go（西元 yyyy/mm/dd）。
// 收件人固定（Ina 指定），寄件身分 = jptour-operation@kkday.com（回覆原 thread）。

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { NamelistRecord } from "./classify.ts";

/** 固定收件人（Ina 2026-07-27 指定）。 */
export const FUBON_MAIL_RECIPIENTS = {
  to: ["Derek Hsu <derek.hsu@kkday.com>"],
  cc: [
    "Joey Chu <joey.chu@kkday.com>",
    "OP主管群組 <op-head@kkday.com>",
    "jptour-operation@kkday.com",
  ],
  from: "日本運営ツアーチーム <jptour-operation@kkday.com>",
  預設主旨: "【機密】一日旅遊投保參考名單 JP",
} as const;

/** 西元 YYYY-MM-DD → "YYYY/MM/DD"。 */
function toWesternSlash(ymd: string): string {
  const m = (ymd ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return (ymd ?? "").trim();
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

/** 由名單組出中文簡潔內文。出團日/商品編號皆去重。 */
export function buildReplyBody(records: NamelistRecord[]): string {
  const dates = [...new Set(records.map((r) => toWesternSlash(r.departureDate)).filter(Boolean))].sort();
  // 商品編號去重（prod_oid → 中文品名），保序
  const seen = new Set<string>();
  const prods: Array<{ oid: string; name: string }> = [];
  for (const r of records) {
    const oid = (r.prodOid ?? "").trim();
    if (!oid || seen.has(oid)) continue;
    seen.add(oid);
    prods.push({ oid, name: (r.prodNameZh ?? "").trim() });
  }
  const prodLines = prods.map((p) => `　・${p.oid}${p.name ? `（${p.name}）` : ""}`).join("\n");
  return [
    "Hi all,",
    "",
    `出團日：${dates.join("、")}`,
    "商品編號：",
    prodLines,
    "",
    "已加保完成，保單與人員名單如附件。",
    "",
    "—— 本信由系統自動發送",
  ].join("\n");
}

export interface MailAttachment {
  path: string;
  filename?: string;
  contentType?: string;
}

export interface ReplyMailPlan {
  to: string[];
  cc: string[];
  from: string;
  subject: string;
  body: string;
  attachments: MailAttachment[];
  /**
   * 選填的 HTML 版本。有值時信會組成 multipart/alternative（純文字＋HTML），
   * 收信軟體挑一個顯示——不支援 HTML 的仍看得到純文字，資訊不會消失。
   * 用途：把長網址收成「點這裡填寫」一行字（Ina 2026-08-15：專屬連結太長）。
   */
  html?: string;
  /** 回覆原信 thread 用（Gmail threadId + 原信 Message-ID）。 */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

/** 由名單 + 附件組出完整回信計畫（收件人固定，主旨自動加 Re:）。 */
export function buildReplyPlan(
  records: NamelistRecord[],
  attachments: MailAttachment[],
  opts: { subject?: string; threadId?: string; inReplyTo?: string; references?: string } = {},
): ReplyMailPlan {
  const base = opts.subject || FUBON_MAIL_RECIPIENTS.預設主旨;
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
  return {
    to: [...FUBON_MAIL_RECIPIENTS.to],
    cc: [...FUBON_MAIL_RECIPIENTS.cc],
    from: FUBON_MAIL_RECIPIENTS.from,
    subject,
    body: buildReplyBody(records),
    attachments,
    threadId: opts.threadId,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  };
}

/** RFC2047 編碼標頭（中文主旨/顯示名）。 */
function encodeHeader(s: string): string {
  // 純 ASCII 免編碼
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;
}

/** 顯示名含中文時編碼，email 位址保留。 */
function encodeAddress(addr: string): string {
  const m = addr.match(/^(.*?)\s*<([^>]+)>$/);
  if (!m) return addr;
  const name = m[1].trim().replace(/^"|"$/g, "");
  return name ? `${encodeHeader(name)} <${m[2]}>` : `<${m[2]}>`;
}

/** 組 RFC822 MIME（multipart/mixed），回傳 Gmail API 用的 base64url raw 字串。 */
export function buildRawMessage(plan: ReplyMailPlan): string {
  const boundary = "==fubon_boundary_kkday==";
  const headers: string[] = [
    `From: ${encodeAddress(plan.from)}`,
    `To: ${plan.to.map(encodeAddress).join(", ")}`,
    // 沒有副本就整個標頭省掉：空的 `Cc:` 是合法但難看，而且有些郵件軟體會顯示成
    // 「副本：（空白）」，讓人以為漏填了誰
    ...(plan.cc.length ? [`Cc: ${plan.cc.map(encodeAddress).join(", ")}`] : []),
    `Subject: ${encodeHeader(plan.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (plan.inReplyTo) headers.push(`In-Reply-To: ${plan.inReplyTo}`);
  if (plan.references) headers.push(`References: ${plan.references}`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const b64 = (t: string) => Buffer.from(t, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const parts: string[] = [];
  // 內文：有 HTML 版就包成 alternative，兩份都放；收信軟體挑一個顯示。
  // 純文字**永遠都在**——不能讓只收純文字的信箱看到空白信。
  if (plan.html) {
    const alt = "==kkday_alt==";
    parts.push(
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(plan.body),
      `--${alt}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(plan.html),
      `--${alt}--`,
    );
  } else {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(plan.body),
    );
  }
  // 附件
  for (const att of plan.attachments) {
    const name = att.filename || basename(att.path);
    const b64 = readFileSync(att.path).toString("base64").replace(/(.{76})/g, "$1\r\n");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType || "application/pdf"}; name="${encodeHeader(name)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encodeHeader(name)}"`,
      "",
      b64,
    );
  }
  parts.push(`--${boundary}--`, "");

  const raw = headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
  return Buffer.from(raw, "utf-8").toString("base64url");
}

/**
 * 透過 Gmail API 送出（回覆原 thread）。需 OAuth（GOOGLE_OAUTH_* 環境變數）。
 * 尚未設定 OAuth 前，測試走 writeEml() 產 .eml 預覽即可。
 */
export async function sendReplyViaGmail(plan: ReplyMailPlan, env = process.env): Promise<string> {
  const { google } = await import("googleapis");
  const oauth = new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: buildRawMessage(plan), threadId: plan.threadId },
  });
  return res.data.id ?? "";
}

/** 純 email 位址（去掉顯示名），Resend 的 to/cc 用。 */
function bareAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return m ? m[1] : addr.trim();
}

/**
 * 透過 Resend 送出回信（同 team 現成做法，免 GCP OAuth）。
 * 需環境變數 RESEND_API_KEY；from 用 RESEND_FROM（須為 Resend 已驗證網域，
 * 如 jptour-operation@kkday.com）。附件走 base64，reply thread 用 In-Reply-To 標頭。
 * dryRun=true（預設）只組不寄，回傳 null，供督導預覽。
 */
export async function sendReplyViaResend(
  plan: ReplyMailPlan,
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<string | null> {
  const env = opts.env ?? process.env;
  const dryRun = opts.dryRun ?? true;
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM || plan.from;

  const attachments = plan.attachments.map((a) => ({
    filename: a.filename || basename(a.path),
    content: readFileSync(a.path).toString("base64"),
  }));
  const headers: Record<string, string> = {};
  if (plan.inReplyTo) headers["In-Reply-To"] = plan.inReplyTo;
  if (plan.references) headers["References"] = plan.references;

  if (dryRun) {
    console.log(`【dry-run】Resend 未寄出。from=${from} to=${plan.to.map(bareAddress).join(",")} cc=${plan.cc.map(bareAddress).join(",")} 附件=${attachments.map((a) => a.filename).join("、")}`);
    return null;
  }

  if (!apiKey) throw new Error("缺少 RESEND_API_KEY（放進 .env.local）");
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: plan.to.map(bareAddress),
    cc: plan.cc.map(bareAddress),
    subject: plan.subject,
    text: plan.body,
    attachments,
    headers: Object.keys(headers).length ? headers : undefined,
  });
  if (error) throw new Error(`Resend 寄信失敗：${JSON.stringify(error)}`);
  return data?.id ?? "";
}

/** 把回信輸出成 .eml（雙擊即用郵件軟體開，供人工預覽/測試）。 */
export function toEml(plan: ReplyMailPlan): string {
  // .eml 用未編碼的原始 MIME（buildRawMessage 是 base64url，這裡直接組可讀版）
  const raw = Buffer.from(buildRawMessage(plan), "base64url").toString("utf-8");
  return raw;
}
