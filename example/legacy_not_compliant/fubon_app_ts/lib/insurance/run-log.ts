// 把每次投保跑的結果記到 Google Sheet（沿用 repo 既有 service account，免 OAuth）。
// 需環境變數：GOOGLE_SERVICE_ACCOUNT_EMAIL、GOOGLE_PRIVATE_KEY_B64、FUBON_LOG_SHEET_ID。
// Sheet 需把該 service account email 加為「編輯者」，並有一個分頁（預設「投保紀錄」）。

const SHEET_TAB = "投保紀錄";
const HEADER = [
  "時間(JST)", "出團日", "團號", "天數", "保額(萬)", "人數",
  "模式", "結果", "保單號", "證明書連結", "保費", "商品編號", "名冊PDF", "錯誤", "觸發來源",
];

/** 一桶（一張保單）的記錄列。 */
export interface RunLogRow {
  出團日: string;
  團號: string;
  天數: number;
  保額萬: number;
  人數: number;
  模式: "dry-run" | "真送";
  結果: "成功" | "失敗";
  保單號?: string;
  證明書連結?: string;
  保費?: string;
  商品編號?: string;
  名冊PDF?: string;
  錯誤?: string;
  /** 觸發來源：cron自動 / 手動(帳號) / 排程備援 / 外部觸發。 */
  觸發來源?: string;
  /** 執行期用：此列在 Sheet 的列號（即時寫入後回填，用來補連結）。不寫進 Sheet。 */
  sheetRow?: number;
}

function jstNow(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
}

/**
 * 解析寫 Sheet 用的授權：優先用 OAuth（credentials.json + token.json，與抓信/上傳同一組），
 * 否則退回 app 現有的 service account（GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY_B64）。
 */
export async function getSheetsAuth(env: NodeJS.ProcessEnv = process.env) {
  const { getGoogleAuth } = await import("./google-auth.ts");
  return getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"], env);
}

async function getSheets(env: NodeJS.ProcessEnv) {
  const { google } = await import("googleapis");
  return google.sheets({ version: "v4", auth: (await getSheetsAuth(env)) as any });
}

/** 確保分頁存在且第一列是表頭（第一次自動建）。 */
async function ensureTab(sheets: any, sheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const has = (meta.data.sheets || []).some((s: any) => s.properties?.title === SHEET_TAB);
  if (!has) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] },
    });
  }
  const head = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:N1` });
  if (!head.data.values || head.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
  }
}

const EXCLUDE_TAB = "排除未投保";
const EXCLUDE_HEADER = ["時間(JST)", "姓名", "身分證/護照", "出團日", "排除原因"];

/** 一筆被排除（格式不符或同證號去重）的人。 */
export interface ExcludeRow {
  姓名: string;
  證號: string;
  出團日: string;
  原因: string;
}

/**
 * 把被排除／去重的人寫進 Sheet「排除未投保」分頁（受存取控管，雲端跑也留得住）。
 * 一樣先寫本機 CSV 備份。dryRun 或未設 Sheet 只印不寫。回傳是否寫入 Sheet。
 * ⚠️ 含身分證/護照號 → 只進受控 Sheet，絕不落地到 GitHub artifact。
 */
export async function appendExclusions(
  rows: ExcludeRow[],
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv; localDir?: string } = {},
): Promise<boolean> {
  if (!rows.length) return false;
  const env = opts.env ?? process.env;
  const ts = jstNow();
  const values = rows.map((r) => [ts, r.姓名, r.證號, r.出團日, r.原因]);

  if (opts.localDir) {
    const { appendFileSync, existsSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(opts.localDir, { recursive: true });
    const p = join(opts.localDir, "_排除未投保.csv");
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    if (!existsSync(p)) appendFileSync(p, "﻿" + EXCLUDE_HEADER.map(esc).join(",") + "\r\n", "utf-8");
    appendFileSync(p, values.map((row) => row.map(esc).join(",")).join("\r\n") + "\r\n", "utf-8");
  }

  const sheetId = env.FUBON_LOG_SHEET_ID;
  if (!sheetId || opts.dryRun) return false;
  const sheets = await getSheets(env);
  // 確保分頁+表頭
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const has = (meta.data.sheets || []).some((s: any) => s.properties?.title === EXCLUDE_TAB);
  if (!has) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: EXCLUDE_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${EXCLUDE_TAB}!A1`, valueInputOption: "RAW",
      requestBody: { values: [EXCLUDE_HEADER] },
    });
  }
  // 去重：讀現有清單，同一人（出團日|證號|姓名）已在就不再重複寫
  // （每次跑、備援排程、重跑都會呼叫本函式，若不去重會一直累積重複列）。
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${EXCLUDE_TAB}!B2:D` })
    .then((r: any) => new Set((r.data.values ?? []).map((row: string[]) => `${row[2] ?? ""}|${row[1] ?? ""}|${row[0] ?? ""}`)))
    .catch(() => new Set<string>());
  const fresh = values.filter((v) => !existing.has(`${v[3]}|${v[2]}|${v[1]}`)); // v=[ts,姓名,證號,出團日,原因]
  if (!fresh.length) {
    console.log(`（排除清單已含這 ${rows.length} 筆，略過不重複寫）`);
    return false;
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: `${EXCLUDE_TAB}!A:E`,
    valueInputOption: "RAW", requestBody: { values: fresh },
  });
  console.log(`📊 已記錄 ${fresh.length} 筆排除到 Sheet「${EXCLUDE_TAB}」（去重後）。`);
  return true;
}

/**
 * 從 Sheet 讀「已成功真送」的團 key（`出團日|團號`），供冪等去重。
 * GitHub 代管機器每次都是全新環境、本機帳本 .fubon-submitted.json 會消失，
 * 故以 Sheet 為單一真相：同一團若已成功真送，重跑不會再送一次。
 * 未設 FUBON_LOG_SHEET_ID 或讀取失敗時回空集合（退回只靠本機帳本，不阻斷流程）。
 */
export async function loadSubmittedKeys(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const sheetId = env.FUBON_LOG_SHEET_ID;
  if (!sheetId) return keys;
  try {
    const sheets = await getSheets(env);
    // B=出團日、C=團號、G=模式、H=結果
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_TAB}!B2:H`,
    });
    for (const row of (resp.data.values ?? []) as string[][]) {
      const [dep, tuan, , , , mode, result] = row;
      if (mode === "真送" && result === "成功" && dep && tuan) keys.add(`${dep}|${tuan}`);
    }
  } catch (e) {
    console.warn("讀 Sheet 已投保清單失敗（改只靠本機帳本）：", (e as Error).message);
  }
  return keys;
}

/** 一列 → 14 欄陣列（與 HEADER 對齊）。 */
function rowToValues(r: RunLogRow, ts: string): (string | number)[] {
  return [
    ts, r.出團日, r.團號, r.天數, r.保額萬, r.人數,
    r.模式, r.結果, r.保單號 ?? "", r.證明書連結 ?? "", r.保費 ?? "", r.商品編號 ?? "", r.名冊PDF ?? "", r.錯誤 ?? "", r.觸發來源 ?? "",
  ];
}

/** 本機 CSV 備份（單列）。 */
async function appendLocalCsv(row: RunLogRow, ts: string, localDir: string): Promise<void> {
  const { appendFileSync, existsSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(localDir, { recursive: true });
  const p = join(localDir, "投保紀錄.csv");
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  if (!existsSync(p)) appendFileSync(p, "﻿" + HEADER.map(esc).join(",") + "\r\n", "utf-8");
  appendFileSync(p, rowToValues(row, ts).map(esc).join(",") + "\r\n", "utf-8");
}

/**
 * 立刻把「單一桶」的結果寫進 Sheet（送出成功後馬上呼叫），回傳寫入的列號（1-based）。
 * 目的：富邦一收單就有持久紀錄 → 就算之後程式崩潰，備援/重跑靠 Sheet 冪等也不會重複投保。
 * dryRun 或未設 Sheet 只寫本機 CSV、回傳 null。
 */
export async function appendRunLogRow(
  row: RunLogRow,
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv; localDir?: string } = {},
): Promise<number | null> {
  const env = opts.env ?? process.env;
  const ts = jstNow();
  if (opts.localDir) await appendLocalCsv(row, ts, opts.localDir).catch(() => {});
  const sheetId = env.FUBON_LOG_SHEET_ID;
  if (!sheetId || opts.dryRun) return null;
  const sheets = await getSheets(env);
  await ensureTab(sheets, sheetId);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: `${SHEET_TAB}!A:N`,
    valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowToValues(row, ts)] },
  });
  const m = (res.data.updates?.updatedRange || "").match(/![A-Z]+(\d+):/);
  return m ? parseInt(m[1], 10) : null;
}

/** 補寫某列的連結/保費（送出後拿到證明書連結、名冊連結時用）。 */
export async function updateRunLogRow(
  rowNo: number,
  patch: { 證明書連結?: string; 名冊PDF?: string; 保費?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const sheetId = env.FUBON_LOG_SHEET_ID;
  if (!sheetId || !rowNo) return;
  const sheets = await getSheets(env);
  const data: { range: string; values: string[][] }[] = [];
  if (patch.證明書連結 !== undefined) data.push({ range: `${SHEET_TAB}!J${rowNo}`, values: [[patch.證明書連結]] });
  if (patch.保費 !== undefined) data.push({ range: `${SHEET_TAB}!K${rowNo}`, values: [[patch.保費]] });
  if (patch.名冊PDF !== undefined) data.push({ range: `${SHEET_TAB}!M${rowNo}`, values: [[patch.名冊PDF]] });
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data } });
}

/**
 * 把一次跑的多桶結果附加到 Sheet。dryRun 或未設 FUBON_LOG_SHEET_ID 時只印不寫。
 * 回傳是否真的寫入。
 */
export async function appendRunLog(
  rows: RunLogRow[],
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv; localDir?: string } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  const ts = jstNow();
  const values = rows.map((r) => [
    ts, r.出團日, r.團號, r.天數, r.保額萬, r.人數,
    r.模式, r.結果, r.保單號 ?? "", r.證明書連結 ?? "", r.保費 ?? "", r.商品編號 ?? "", r.名冊PDF ?? "", r.錯誤 ?? "", r.觸發來源 ?? "",
  ]);

  // 本機備份：不論有無 Sheet 憑證都寫一份 CSV，timestamp 一定留得住。
  if (opts.localDir && rows.length) {
    const { appendFileSync, existsSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(opts.localDir, { recursive: true });
    const p = join(opts.localDir, "投保紀錄.csv");
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    if (!existsSync(p)) appendFileSync(p, "﻿" + HEADER.map(esc).join(",") + "\r\n", "utf-8");
    appendFileSync(p, values.map((row) => row.map(esc).join(",")).join("\r\n") + "\r\n", "utf-8");
    console.log(`💾 投保紀錄本機備份 → ${p}`);
  }

  const sheetId = env.FUBON_LOG_SHEET_ID;
  if (!sheetId) {
    console.log("（未設 FUBON_LOG_SHEET_ID，略過 Sheet 記錄；已寫本機 CSV）");
    return false;
  }
  if (opts.dryRun) {
    console.log(`【dry-run】Sheet 未寫入（${rows.length} 列）。`);
    return false;
  }
  const sheets = await getSheets(env);
  await ensureTab(sheets, sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${SHEET_TAB}!A:N`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(`📊 已記錄 ${rows.length} 列到 Sheet。`);
  return true;
}
