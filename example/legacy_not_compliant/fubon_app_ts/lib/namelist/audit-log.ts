/**
 * 執行紀錄（稽核表）——「這團從頭到尾發生了什麼」的一條時間軸。
 *
 * 為什麼需要（真的開始寄信給導遊之前的硬條件）：信寄出去收不回來，
 * 而現在沒有任何一張表回答得了「昨天寄了哪些、誰收到、幾點寄的」。
 * 出事時人問的也從來不是「信寄了嗎」，是「這團到底怎麼了」——所以記的是**動作**，
 * 不是只有寄信：DAP 刷新、名單產出、FNL 通知、車公司回報、催件、SCM 回填，全部一列。
 *
 * 🔴 **這張表記「發生了什麼」，不記「內容是什麼」。**
 * 車公司回報的明細在 Portal、名單內容在 PDF、司導資訊在 SCM——這裡只放連結指過去。
 * 再存一份的話，同一件事就有兩份資料，對不起來時沒人知道該信哪一個。
 *
 * 🔒 **不放旅客個資**（姓名／電話／生日／LINE ID），司機電話也不放。
 *    只放人數與連結；要看內容就去開權限受控的那份 PDF。
 *    因此這張表本身不是個資檔案，可以放寬給 AM 看。
 *
 * ⚠️ **失敗的動作一定要寫進去。** 只記成功的話，這張表會變成「一切正常」的假象，
 *    而真正要查的永遠是沒成功的那幾列。
 *
 * ⚠️ 寫紀錄失敗**不可以中斷主流程**：名單該產還是要產、信該寄還是要寄。
 *    但也不能安靜吞掉——寫不進去就在 log 裡吵，讓人知道今天這幾列沒進表。
 */
import { google } from "googleapis";
import { getGoogleAuth } from "../insurance/google-auth.ts";

export const AUDIT_TAB = "執行紀錄";
export const AUDIT_HEADER = [
  "時間(JST)", "出團日", "團號", "動作", "對象／來源", "結果", "摘要", "連結", "觸發來源",
] as const;

/** 動作分類。固定這幾種，不要每支腳本各自造字——分類一亂就沒辦法篩。 */
export type AuditAction =
  | "DAP刷新" | "名單產出" | "寄名單" | "FNL通知" | "車公司回報" | "催件" | "SCM回填" | "體檢";

export type AuditRow = {
  /** 出發日 YYYY-MM-DD */
  date: string;
  /** 團號；沒有團號的動作（如 DAP 刷新）留空 */
  tourCode?: string;
  action: AuditAction;
  /** 寄給誰／哪家車公司／哪張訂單。**不要放旅客姓名。** */
  target?: string;
  result: "成功" | "失敗" | "收到" | "已發" | "略過";
  /** 一句話講清楚：幾人、第幾輪、為什麼失敗 */
  note?: string;
  /** 指回明細的連結（PDF／Portal／SCM），沒有就留空 */
  link?: string;
};

/** 日本時間的 `MM/DD HH:mm`。表已經按日分列，不需要年。 */
export function jstStamp(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
}

/** 觸發來源：分得出「排程自己跑」與「有人手動按」，出事時這一欄很關鍵。 */
export function triggerSource(env = process.env): string {
  const ev = (env.JP_TRIGGER_EVENT ?? "").trim();
  const input = (env.JP_TRIGGER_INPUT ?? "").trim();
  const actor = (env.JP_TRIGGER_ACTOR ?? "").trim();
  if (input === "cron") return "cron自動";
  if (!ev) return "本機";
  return actor ? `手動(${actor})` : ev;
}

export function toValues(r: AuditRow, now = new Date(), env = process.env): string[] {
  return [
    jstStamp(now), r.date, r.tourCode ?? "", r.action, r.target ?? "",
    r.result, r.note ?? "", r.link ?? "", triggerSource(env),
  ];
}

const SHEET_ID = () => (process.env.JP_AUDIT_SHEET_ID ?? "").trim();

/**
 * 補一列（或多列）。回傳有沒有寫進去。
 * 沒設 `JP_AUDIT_SHEET_ID` 就只在 log 印出來——**不當作錯誤**，
 * 本機隨手跑的時候不該因為少一個環境變數就中止。
 */
export async function auditLog(
  rows: AuditRow[], now = new Date(), opts: { dedupe?: boolean } = {},
): Promise<boolean> {
  if (!rows.length) return true;
  const id = SHEET_ID();
  const lines = rows.map((r) => toValues(r, now).join("｜"));
  if (!id) {
    console.log(`\n📋 執行紀錄（沒設 JP_AUDIT_SHEET_ID，只印不寫）：\n  ${lines.join("\n  ")}`);
    return false;
  }
  try {
    const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
    const s = google.sheets({ version: "v4", auth });

    /**
     * `dedupe` 給「每次執行都會看到同一件事」的動作用——例如車公司昨天填的那筆，
     * 12:00、16:00、17:00 每輪都讀得到。不去重的話一天會多出十幾列一模一樣的紀錄，
     * 表就變得沒人想看。用「出團日＋團號＋動作＋摘要」比對已經寫過的列。
     * （時間欄不參與比對——同一件事在不同時間被讀到，還是同一件事。）
     */
    if (opts.dedupe) {
      const cur = await s.spreadsheets.values.get({ spreadsheetId: id, range: `'${AUDIT_TAB}'!B:G` });
      const seen = new Set((cur.data.values ?? []).slice(1)
        .map((v) => [v[0], v[1], v[2], v[5]].map((x) => String(x ?? "")).join("｜")));
      rows = rows.filter((r) => !seen.has([r.date, r.tourCode ?? "", r.action, r.note ?? ""].join("｜")));
      if (!rows.length) { console.log("\n📋 執行紀錄：這幾筆都已經記過了，沒有新列"); return true; }
    }

    await s.spreadsheets.values.append({
      spreadsheetId: id,
      range: `'${AUDIT_TAB}'!A:I`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows.map((r) => toValues(r, now)) },
    });
    console.log(`\n📋 執行紀錄已寫入 ${rows.length} 列`);
    return true;
  } catch (e) {
    // 寫不進去不擋主流程，但要吵——安靜漏記跟「今天沒事」長得一模一樣
    console.log(`\n🚨 執行紀錄寫不進去（${String((e as Error).message).slice(0, 120)}）。這幾列沒進表：\n  ${lines.join("\n  ")}`);
    return false;
  }
}

/**
 * 這一則今天發過了沒（Ina 2026-08-18 那天 16:00 那批被觸發五次，測試群收到六則）。
 *
 * **為什麼要有**：cron-job.org 逾時會重打、人也會手動補跑，而排程本身沒有任何
 * 「這批已經跑過」的概念。信有台帳擋著不會重寄，Slack 卻每次都照發——
 * 對收訊息的人來說，那就是同一件事被喊了五次，而且 webhook 發出去刪不掉。
 *
 * 用執行紀錄當狀態：發出去之前先看有沒有同一天同一則的紀錄，發完立刻記一列。
 * 讀不到表（沒設 ID、API 掛了）時**回 false ＝ 照發**——寧可重複，也不要
 * 因為查不到而整天不發（那才是真的沒人知道出事）。
 */
export async function slackSentToday(date: string, tag: string): Promise<boolean> {
  const id = SHEET_ID();
  if (!id) return false;
  try {
    const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    const s = google.sheets({ version: "v4", auth });
    const cur = await s.spreadsheets.values.get({ spreadsheetId: id, range: `'${AUDIT_TAB}'!B:G` });
    return (cur.data.values ?? []).slice(1)
      .some((v) => String(v[0] ?? "") === date && String(v[2] ?? "") === "Slack" && String(v[5] ?? "") === tag);
  } catch (e) {
    console.log(`⚠️ 查不到執行紀錄（${String((e as Error).message).slice(0, 60)}）→ 這則照發，寧可重複也不要漏發`);
    return false;
  }
}

/** 發完記一列，下一次觸發就不會再發同一則。 */
export async function markSlackSent(date: string, tag: string): Promise<void> {
  await auditLog([{ date, tourCode: "", action: "Slack", result: "已發", note: tag }]);
}

/**
 * 今天已經**成功**寫進 SCM 的訂單編號。
 *
 * 為什麼一定要有：SCM 每存一次就通知客人一次（見 reference_scm_pretrip_reminder_api）。
 * 17:00 那批被重打時，同一張單會被再寫一次，客人手機再響一次——
 * 而客人不會知道那是系統重試，只會覺得被騷擾。
 *
 * 只擋**成功過**的：失敗的要能重試（今天就是先失敗、重登之後才成功）。
 * 查不到表時回空集合＝照推——漏推的後果（客人看不到司導）比重複通知嚴重。
 */
export async function scmDoneToday(date: string): Promise<Set<string>> {
  const id = SHEET_ID();
  if (!id) return new Set();
  try {
    const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    const s = google.sheets({ version: "v4", auth });
    const cur = await s.spreadsheets.values.get({ spreadsheetId: id, range: `'${AUDIT_TAB}'!B:G` });
    return new Set((cur.data.values ?? []).slice(1)
      .filter((v) => String(v[0] ?? "") === date && String(v[2] ?? "") === "SCM回填" && String(v[4] ?? "") === "成功")
      .map((v) => String(v[3] ?? "").trim()).filter(Boolean));
  } catch (e) {
    console.log(`⚠️ 查不到執行紀錄（${String((e as Error).message).slice(0, 60)}）→ 照推，漏推比重複通知嚴重`);
    return new Set();
  }
}
