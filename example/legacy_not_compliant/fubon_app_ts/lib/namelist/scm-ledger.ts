/**
 * 17:00 之後的定時檢查：Portal 有新資料時，決定「直接回填 SCM」還是「先給人確認」。
 *
 * 為什麼要分兩種（Ina 2026-08-13）：
 *  - **第一次填**：客人手上什麼都沒有，晚一分鐘都是損失，而且沒有舊值可比、不存在改錯的風險
 *    → 直接回填，不等人確認。
 *  - **改動**：SCM 每存一次就發一次信給客人，改錯很難看，但**也不能卡著等人點頭**——
 *    晚上沒人看 Slack，客人就會拿著舊的司機資訊出門。
 *    → 折衷：**先 tag Klo & Winnie，下一次每小時檢查時自動寫出更正**。
 *      他們有一小時可以喊停；沒人喊停，客人一小時內一定拿到正確資訊。
 *
 * 時間窗：D-1 17:00 → 出發當天 06:00，**每小時**一次（Ina 2026-08-13）。
 * 06:00 之後不再自動處理——那時候團差不多要出發了，寫進 SCM 客人也來不及看。
 *
 * ⚠️ 只比對「會讓客人看到不一樣東西」的欄位：司機姓名／電話／車號／通訊帳號。
 *    車公司重送一模一樣的內容不算變更，不該吵到任何人。
 */

export type DriverInfo = {
  name: string;
  phone: string;
  plateNumber: string;
  imAccount: string;
};

/** 已經寫進 SCM 的內容，一團一筆。 */
export type ScmSentRecord = {
  key: string;          // 出發日｜團號
  at: string;           // 寫進去的時間
  info: DriverInfo;
};

export type Decision =
  | { action: "回填"; reason: string }
  /** 變更已過寬限期 → 這輪寫出更正（客人會收到更新通知） */
  | { action: "回填更正"; reason: string; before: DriverInfo; after: DriverInfo }
  /** 剛偵測到變更 → 只 tag，不寫。下一輪沒被喊停就自動寫 */
  | { action: "先通知"; reason: string; before: DriverInfo; after: DriverInfo }
  | { action: "不動作"; reason: string };

/** 一小時的反應時間：跟每小時檢查的節奏一致，等於「下一次檢查就寫」。 */
export const GRACE_MS = 3600_000;

const norm = (v: string) => (v ?? "").replace(/[\s　-]/g, "").toLowerCase();

/** 只看客人會感覺到差異的欄位。 */
export function sameInfo(a: DriverInfo, b: DriverInfo): boolean {
  return (["name", "phone", "plateNumber", "imAccount"] as const)
    .every((k) => norm(a[k]) === norm(b[k]));
}

export const keyOf = (date: string, tourCode: string) =>
  `${date}|${tourCode.replace(/[\s　]/g, "").toUpperCase()}`;

/**
 * @param sent    這團先前寫進 SCM 的內容（沒寫過就是 undefined）
 * @param current Portal 上現在最新的內容
 * @param pending 這個變更是**什麼時候第一次被看到**的（上一輪記下來的；沒有就是這輪才看到）
 * @param now     現在（JST）
 */
export function decide(
  sent: ScmSentRecord | undefined, current: DriverInfo,
  pending?: { at: string; after: DriverInfo }, now: Date = new Date(),
): Decision {
  const filled = (current.name ?? "").trim() !== "";
  if (!filled) return { action: "不動作", reason: "Portal 上還是沒有司機姓名" };

  if (!sent) {
    return { action: "回填", reason: "SCM 還沒有這團的司導資訊 → 第一次填，客人正在等，直接寫" };
  }
  if (sameInfo(sent.info, current)) {
    return { action: "不動作", reason: "跟已經寫進 SCM 的一模一樣（車公司重送）" };
  }
  // 上一輪就看到「同一個」變更 → 寬限期過了就寫。
  // 內容又變了（車公司改了兩次）要重新計時，不然只會寫到中間那一版。
  if (pending && sameInfo(pending.after, current) && now.getTime() - Date.parse(pending.at) >= GRACE_MS) {
    return {
      action: "回填更正",
      reason: "變更已通知超過一小時、沒有人喊停 → 自動寫出更正",
      before: sent.info, after: current,
    };
  }
  return {
    action: "先通知",
    reason: pending && !sameInfo(pending.after, current)
      ? "內容又改了 → 重新通知並重新計時"
      : "SCM 已經有值、內容變了 → 先 tag Klo & Winnie，下一輪沒被喊停就自動寫",
    before: sent.info, after: current,
  };
}

/** 給 Slack 用：把改了什麼講清楚，不要只說「有變更」。 */
export function describeChange(before: DriverInfo, after: DriverInfo): string[] {
  const LABEL: Record<keyof DriverInfo, string> = {
    name: "姓名", phone: "電話", plateNumber: "車號", imAccount: "通訊帳號",
  };
  return (Object.keys(LABEL) as (keyof DriverInfo)[])
    .filter((k) => norm(before[k]) !== norm(after[k]))
    .map((k) => `${LABEL[k]}：${before[k] || "（空白）"} → ${after[k] || "（空白）"}`);
}

/**
 * 現在還在自動處理的時間窗內嗎？
 * @param now      現在（JST）
 * @param departure 出發日 YYYY-MM-DD
 */
export function inWatchWindow(now: Date, departure: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(departure);
  if (!m) return false;
  const dep = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const start = dep - 7 * 3600_000;   // 前一天 17:00
  const end = dep + 6 * 3600_000;     // 當天 06:00
  const t = now.getTime();
  return t >= start && t <= end;
}
