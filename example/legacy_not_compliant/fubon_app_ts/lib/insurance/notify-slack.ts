// 投保跑完通知 Slack 群組（Incoming Webhook；無 OAuth，一個網址 POST 即送）。
// 需環境變數 SLACK_WEBHOOK_URL。成功/失敗都通知。

import type { RunLogRow } from "./run-log.ts";

export interface SlackRunSummary {
  出團日: string;
  模式: "dry-run" | "真送";
  rows: RunLogRow[];
  /** 整體是否成功（任一桶失敗即 false）。 */
  ok: boolean;
  /** 回信狀態（可選）。 */
  mailStatus?: string;
  /** 中止/整體異常原因（登入失敗、沒抓到名單…）；有值即視為失敗。 */
  abortReason?: string;
  /** 完整記錄以及憑證 Google Sheet 連結（附在訊息末）。 */
  sheetUrl?: string;
  /** 保單/名冊存放的共用雲端硬碟資料夾連結（附在訊息末）。 */
  driveFolderUrl?: string;
  /** 本次商品（去重）：oid + 中文品名。 */
  products?: Array<{ oid: string; name?: string }>;
  /** 失敗/中止時要 tag 的 Slack 使用者 ID（如 U04HADNRJJ1）。成功不 tag。 */
  mentionUserId?: string;
  /** 全部桶都因冪等被略過（已投保過）→ 正常，非失敗。 */
  allSkipped?: boolean;
  /** 被略過的桶數。 */
  skipped?: number;
  /** 被排除未投保的人數（格式/證號問題）→ 需人工進 Sheet 處理。 */
  excludedCount?: number;
  /** 前兩週人工並行核對期間，每則通知都要 @ 的稽核人（Demi & Klo）Slack ID。核對結束移除即停 tag。 */
  auditMentionIds?: string[];
}

/** 組 Slack 訊息文字。 */
export function buildSlackText(s: SlackRunSummary): string {
  const modeTag = s.模式 === "真送" ? "" : "（dry-run 測試）";
  const record = s.sheetUrl ? `📎 <${s.sheetUrl}|完整記錄以及憑證>` : "";
  const driveLine = s.driveFolderUrl ? `📁 <${s.driveFolderUrl}|保單/名冊資料夾>` : "";
  const ping = s.mentionUserId ? `<@${s.mentionUserId}>` : ""; // 失敗才 tag
  // 每則都 @ Demi & Klo（Ina 2026-08-18：試跑結束了，但還是要 tag，他們要看）。
  // 稽核 + 失敗 tag 放「獨立一行」，後面才接內文。
  const auditPing = s.auditMentionIds?.length ? s.auditMentionIds.map((id) => `<@${id}>`).join(" ") : "";
  const mentionLine = [auditPing, ping].filter(Boolean).join(" ");
  /**
   * **試跑階段結束（2026-08-19 起）** → 拿掉「請進富邦後台驗證投保內容」那句。
   *
   * tag 還是照 tag，但意義變了：從「請你去核對」變成「讓你知道今天保了什麼」。
   * 留著那句的話，每天都在要求一件已經不用做的事——而天天出現又不用做的提醒，
   * 會讓人開始整則跳過，連真的要處理的失敗訊息一起跳掉。
   */
  // 有人被排除未投保 → 一定要提醒人工處理（這些人沒被保到）
  const exLine = s.excludedCount
    ? `⚠️ 有 ${s.excludedCount} 人被排除、未投保，請進 Sheet「排除未投保」分頁確認`
    : "";
  // 中止（沒跑到任何桶）→ 明確標示異常，絕不誤報完成
  if (s.abortReason) {
    return [mentionLine, `🚨 富邦投保中止${modeTag}`, `出團日 ${s.出團日 || "(未知)"}｜原因：${s.abortReason}`, record, driveLine].filter(Boolean).join("\n");
  }
  // 全部已投保過（冪等略過）→ 正常，綠字不 tag、不當異常
  if (s.allSkipped) {
    return [`✅ 富邦投保：全部已投保過${modeTag}`, `出團日 ${s.出團日 || "(未知)"}｜${s.skipped ?? 0} 桶皆已投保，本次無新單`, record, driveLine].filter(Boolean).join("\n");
  }
  if (s.rows.length === 0) {
    return [mentionLine, `🚨 富邦投保未處理任何桶${modeTag}`, `出團日 ${s.出團日 || "(未知)"}｜請人工確認`, record, driveLine].filter(Boolean).join("\n");
  }
  const head = s.ok ? "✅ 富邦投保完成" : "❌ 富邦投保有失敗";
  const total = s.rows.reduce((a, r) => a + r.人數, 0);
  const okCount = s.rows.filter((r) => r.結果 === "成功").length;
  // 保單：段落小標 + 縮排（全形空格），不用項目符號；失敗那列標 ⚠️
  const policyLines = s.rows.map((r) => {
    const base = `　${r.保額萬}萬｜${r.天數}日｜${r.人數} 人`;
    return r.結果 === "成功"
      ? `${base}${r.保單號 ? `｜${r.保單號}` : ""}`
      : `⚠️${r.保額萬}萬｜${r.天數}日｜${r.人數} 人｜失敗：${r.錯誤 ?? "未知"}`;
  });
  const policyBlock = ["🎫 *保單*", ...policyLines].join("\n");
  // 商品：段落小標 + 縮排，保留完整品名（不精簡）
  const prodBlock = s.products?.length
    ? [`🗾 *商品（${s.products.length}）*`, ...s.products.map((p) => `　${p.oid}${p.name ? "　" + p.name : ""}`)].join("\n")
    : "";
  // 標題加粗（Slack *粗體*）；摘要（總人數／保單數）提到標題下方一行
  const titleBlock = [
    `*${head}${modeTag}｜出團日 ${s.出團日}*`,
    `共 ${total} 人・${s.rows.length} 張保單（成功 ${okCount}/${s.rows.length}）`,
  ].join("\n");
  const footBlock = [
    exLine,
    [s.mailStatus ? `📧 回信：${s.mailStatus}` : "", record, driveLine].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n");
  // 各區塊用空行隔開，段落分明
  return [mentionLine, titleBlock, policyBlock, prodBlock, footBlock].filter(Boolean).join("\n\n");
}

/** 通用 Slack 發文（健檢等自訂訊息用）。未設 webhook 只印不送。 */
export async function postSlack(
  text: string,
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const url = (opts.env ?? process.env).SLACK_WEBHOOK_URL;
  if (!url) {
    console.log("（未設 SLACK_WEBHOOK_URL，略過 Slack）\n" + text);
    return false;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack 發文失敗：HTTP ${res.status}`);
  return true;
}

/**
 * 發 Slack 通知。未設 SLACK_WEBHOOK_URL 或 dryRun 時只印不送。
 * 回傳是否真的送出。
 */
export async function notifySlack(
  s: SlackRunSummary,
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  const url = env.SLACK_WEBHOOK_URL;
  const text = buildSlackText(s);
  // 「全部已投保過」= 沒有新單、沒事發生（多為備援排程重跑）→ 不發 Slack，免每天多一則噪音。
  // 真成功(有保單)與任何失敗仍會發。
  if (s.allSkipped) {
    console.log("（全部已投保過，無新單，略過 Slack）\n" + text);
    return false;
  }
  if (!url) {
    console.log("（未設 SLACK_WEBHOOK_URL，略過 Slack 通知）\n" + text);
    return false;
  }
  if (opts.dryRun) {
    console.log("【dry-run】Slack 未送：\n" + text);
    return false;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack 通知失敗：HTTP ${res.status}`);
  console.log("💬 已發 Slack 通知。");
  return true;
}
