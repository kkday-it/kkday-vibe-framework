/**
 * 「其他行前資訊」罐頭文（SCM 行前提醒的 otherReminder 欄）。
 *
 * **文案不寫在程式裡**——來源是 AM 既有的
 * 「JP專屬團｜司導＆飯店資料批次發送」→ 分頁「語系訊息罐頭」。
 * 那張表本來就是人在維護的，AM 改字不用改程式，也不會出現兩份文案各自漂開。
 * （我一度手打了一份翻譯，Ina 指正：要用表上的官方版本，不要自己發揮。）
 *
 * 表的結構：一列一個語系，欄位分成「司導」與「司兼隨」兩套前後段
 *   司導：  司導前段 ｜姓名 tel line WhatsApp WeChat ｜司導後段
 *   司兼隨：司兼隨前段｜車號 姓名 tel line          ｜司兼隨後段
 * 前段結尾、後段開頭本身就帶分隔線，所以中間只要塞聯絡資訊那幾行。
 *
 * ⚠️ 「Line帳號：QR CODE照片」是表上原文——SCM 只能放文字 ID、放不了圖，
 *    所以實際填進去的是 LINE ID，QR 仍走憑證那條路。
 * ⚠️ 「因未滿20位旅客」在表上是寫死的，一律保留（Ina 2026-08-13 決定）。
 */
import { google } from "googleapis";
import { getGoogleAuth } from "../insurance/google-auth.ts";

export const CANNED_SHEET_ID = "1KF4I2UkjIvAeupUsnRVsItEL2KuFY_dLs9hnDUxgOAU";

/**
 * 我們自己的罐頭表（共用硬碟｜JP專屬團機器人｜SCM罐頭與執行記錄）。
 *
 * 為什麼另開一份：AM 那張「語系訊息罐頭」有保護範圍寫不進去，而且它同時給既有的
 * 批次發送工具用——那邊的文案後面接聯絡資訊，我們這邊不接，兩個用途的文字已經不同。
 * 各自一份，改動不會互相波及；旁邊的「執行記錄」分頁也留給之後的 log 用。
 */
export const SCM_CANNED_SHEET_ID = "1hE8e1-jxCI72Ld-z0gQvm_s77u_VMqlwJaCMnedbRzU";
const SCM_TAB = "SCM罐頭";
const TAB = "語系訊息罐頭";

export type Locale = "zh-tw" | "zh-hk" | "zh-cn" | "en" | "ko";
export type Scenario = "純司機" | "司兼導";

/** 表上「語系」欄的寫法 → 語系代碼。 */
const LOCALE_OF: Record<string, Locale> = {
  "繁體中文(台灣)": "zh-tw", "繁體中文(香港)": "zh-hk", "简体中文": "zh-cn",
  English: "en", "한국어": "ko",
};

/** 訂單語系代碼 → 罐頭語系。查不到一律用繁中台灣（多數客人），不留空白。 */
export function pickLocale(v: string): Locale {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "zh-hk") return "zh-hk";
  if (s === "zh-cn") return "zh-cn";
  if (s === "ko" || s.startsWith("ko-")) return "ko";
  if (s === "en" || s.startsWith("en-")) return "en";
  return "zh-tw";
}

export type Pack = {
  guideLead: string; guideTail: string;
  driverLead: string; driverTail: string;
  labels: { guideName: string; name: string; tel: string; line: string; whatsapp: string; wechat: string; plate: string };
};

const txt = (v: unknown) => String(v ?? "").trim();

/**
 * 依標題文字定位欄。「姓名」在表上出現兩次（司導區一次、司兼隨區一次），
 * 所以先找到區塊起點，再從那之後找標籤——不能只認欄名，也不能寫死欄號。
 */
function locate(header: string[]) {
  const at = (label: string, from = 0) =>
    header.findIndex((h, i) => i >= from && txt(h) === label);
  const guideStart = at("司導前段");
  const driverStart = at("司兼隨前段");
  if (guideStart < 0 || driverStart < 0) {
    throw new Error(`罐頭表找不到「司導前段」或「司兼隨前段」欄 → 中止。標題列：${header.join(" | ")}`);
  }
  return {
    locale: at("語系"),
    guideLead: guideStart,
    guideTail: at("司導後段", guideStart),
    guideName: at("姓名", guideStart),
    tel: at("tel", guideStart),
    line: at("line", guideStart),
    whatsapp: at("WhatsApp", guideStart),
    wechat: at("WeChat", guideStart),
    driverLead: driverStart,
    driverTail: at("司兼隨後段", driverStart),
    driverName: at("姓名", driverStart),
    plate: at("車號", driverStart),
  };
}

/** 把「語系訊息罐頭」的二維陣列轉成各語系的 Pack。第 0 列是欄號、第 1 列才是標題。 */
export function parsePacks(values: string[][]): Map<Locale, Pack> {
  const rows = (values ?? []).filter((r) => r?.some((c) => txt(c) !== ""));
  const hi = rows.findIndex((r) => r.some((c) => txt(c) === "司導前段"));
  if (hi < 0) throw new Error("罐頭表找不到標題列（沒有「司導前段」這一欄）→ 中止");
  const col = locate(rows[hi]);

  const out = new Map<Locale, Pack>();
  for (const r of rows.slice(hi + 1)) {
    const loc = LOCALE_OF[txt(r[col.locale])];
    if (!loc) continue;                     // 表上多出來的語系先略過，不亂猜對應
    // 前後段可以 trim；**標籤不行**——英文標籤是「Name: 」，結尾那個空格是排版的一部分，
    // trim 掉就會變成「Name:張董」。只去掉尾端換行。
    const g = (i: number) => (i < 0 ? "" : txt(r[i]));
    const label = (i: number) => (i < 0 ? "" : String(r[i] ?? "").replace(/[\r\n]+$/, ""));
    out.set(loc, {
      guideLead: g(col.guideLead), guideTail: g(col.guideTail),
      driverLead: g(col.driverLead), driverTail: g(col.driverTail),
      labels: {
        guideName: label(col.guideName), name: label(col.driverName), tel: label(col.tel),
        line: label(col.line), whatsapp: label(col.whatsapp), wechat: label(col.wechat), plate: label(col.plate),
      },
    });
  }
  if (out.size === 0) throw new Error("罐頭表沒有解析出任何語系 → 中止，不寄出空白內容");
  return out;
}

export async function loadPacks(sheetId = CANNED_SHEET_ID): Promise<Map<Locale, Pack>> {
  const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const s = google.sheets({ version: "v4", auth });
  const r = await s.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${TAB}'!A1:AZ` });
  return parsePacks((r.data.values ?? []) as string[][]);
}

/**
 * 組出 otherReminder 全文。
 *
 * **只有前段與後段，不含聯絡資訊**（Ina 2026-08-13）：姓名／電話／車號／LINE 由 SCM 的
 * driverGuide 結構化欄位自己顯示，罐頭再印一次會變成同樣的資訊出現兩遍。
 * 前段結尾與後段開頭本身就帶分隔線，接起來就是完整的一封。
 */
export function buildReminder(pack: Pack, scenario: Scenario): string {
  const guide = scenario === "純司機";
  const merged = [dropContactIntro(guide ? pack.guideLead : pack.driverLead),
                  guide ? pack.guideTail : pack.driverTail].join("\n");
  // 前段結尾與後段開頭各帶一條分隔線，接起來會變成連續兩條 → 併成一條
  return merged.replace(/^(ー{5,})\n\1$/gm, "$1").replace(/(ー{5,})\n\1/g, "$1");
}

/**
 * 拿掉「以下為導遊聯絡方式及注意事項，請您留意」這種引言（Ina 2026-08-13）。
 *
 * 罐頭後面不再接聯絡資訊了（改由 SCM 的結構化欄位顯示），這句就沒有下文、變成空指。
 *
 * **為什麼不直接改表**：那張罐頭表同時也給既有的批次發送工具用，
 * 那邊的訊息後面確實接著聯絡方式，這句在那裡是通順的。改表會連帶影響它，
 * 所以只在這條路徑上濾掉。
 */
function dropContactIntro(lead: string): string {
  return lead
    .split("\n")
    .filter((l) => !/聯絡方式|联系方式|contact details|연락처/i.test(l))
    .join("\n");
}

/** 我們自己那份表：語系 → 兩種情境的完整內文。 */
export async function loadScmCanned(sheetId = SCM_CANNED_SHEET_ID): Promise<Map<Locale, Record<Scenario, string>>> {
  const auth = await getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const s = google.sheets({ version: "v4", auth });
  const rows = ((await s.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${SCM_TAB}'!A1:D` })).data.values ?? []) as string[][];
  const out = new Map<Locale, Record<Scenario, string>>();
  for (const r of rows.slice(1)) {
    const loc = LOCALE_OF[txt(r[0])];
    // 內文不 trim 尾端空白以外的東西；空的就跳過，寧可回退到組合版也不要送出空白
    if (!loc || !txt(r[1]) || !txt(r[2])) continue;
    out.set(loc, { "純司機": String(r[1]), "司兼導": String(r[2]) });
  }
  if (out.size === 0) throw new Error(`「${SCM_TAB}」沒有解析出任何語系 → 中止，不送出空白的行前提醒`);
  return out;
}
