// 動作層級稽核紀錄：每個步驟（抓信/分桶/印PDF/登入/填單/送出/下載/上傳…）記一列。
// 緩衝在記憶體，跑完一次批次寫進 Google Sheet 分頁「動作紀錄」（沿用 service account）。
// 需環境變數：GOOGLE_SERVICE_ACCOUNT_EMAIL、GOOGLE_PRIVATE_KEY_B64、FUBON_LOG_SHEET_ID。

const ACTION_TAB = "動作紀錄";
const HEADER = ["時間(JST)", "RunID", "階段", "對象", "狀態", "訊息"];

export type ActionStatus = "開始" | "成功" | "失敗" | "略過";

interface ActionRow {
  ts: string;
  runId: string;
  stage: string;
  target: string;
  status: ActionStatus;
  message: string;
}

function jstNow(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
}

/** 產生一次跑的 RunID（可讀時間戳）。 */
export function newRunId(): string {
  return jstNow().replace(/[-: ]/g, "").slice(2); // 如 260728HHMMSS
}

export interface ActionLogger {
  /** 記一個動作（即時印出，並緩衝待批次寫 Sheet）。 */
  log(stage: string, target: string, status: ActionStatus, message?: string): void;
  /** 把緩衝的動作批次寫進 Sheet；另可寫本機 CSV 備份。回傳是否寫入 Sheet。 */
  flush(opts?: { dryRun?: boolean; env?: NodeJS.ProcessEnv; localDir?: string }): Promise<boolean>;
  runId: string;
}

/** 建一個動作紀錄器。 */
export function createActionLogger(runId = newRunId()): ActionLogger {
  const buffer: ActionRow[] = [];
  return {
    runId,
    log(stage, target, status, message = "") {
      const row = { ts: jstNow(), runId, stage, target, status, message };
      buffer.push(row);
      const icon = status === "成功" ? "✓" : status === "失敗" ? "✗" : status === "略過" ? "–" : "▶";
      console.log(`  ${icon} [${stage}]${target ? " " + target : ""}${message ? " — " + message : ""}`);
    },
    async flush(opts = {}) {
      const env = opts.env ?? process.env;

      // 本機備份：不論有無 Sheet 憑證都寫一份 CSV，timestamp 一定留得住。
      if (opts.localDir && buffer.length) {
        const { appendFileSync, existsSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        mkdirSync(opts.localDir, { recursive: true });
        const p = join(opts.localDir, "動作紀錄.csv");
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        if (!existsSync(p)) appendFileSync(p, "﻿" + HEADER.map(esc).join(",") + "\r\n", "utf-8");
        appendFileSync(p, buffer.map((r) => [r.ts, r.runId, r.stage, r.target, r.status, r.message].map(esc).join(",")).join("\r\n") + "\r\n", "utf-8");
        console.log(`💾 動作紀錄本機備份 → ${p}`);
      }

      const sheetId = env.FUBON_LOG_SHEET_ID;
      if (!sheetId) {
        console.log(`（未設 FUBON_LOG_SHEET_ID，略過 Sheet 動作紀錄；已寫本機 CSV，共 ${buffer.length} 筆）`);
        return false;
      }
      if (opts.dryRun) {
        console.log(`【dry-run】動作紀錄未寫入 Sheet（${buffer.length} 筆）。`);
        return false;
      }
      if (!buffer.length) return false;
      const { google } = await import("googleapis");
      const { getSheetsAuth } = await import("./run-log.ts");
      const sheets = google.sheets({ version: "v4", auth: (await getSheetsAuth(env)) as any });
      // 確保分頁+表頭
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const has = (meta.data.sheets || []).some((s: any) => s.properties?.title === ACTION_TAB);
      if (!has) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: ACTION_TAB } } }] },
        });
      }
      const head = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${ACTION_TAB}!A1:F1` });
      if (!head.data.values?.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${ACTION_TAB}!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [HEADER] },
        });
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${ACTION_TAB}!A:F`,
        valueInputOption: "RAW",
        requestBody: { values: buffer.map((r) => [r.ts, r.runId, r.stage, r.target, r.status, r.message]) },
      });
      console.log(`📋 已寫入 ${buffer.length} 筆動作紀錄。`);
      return true;
    },
  };
}
