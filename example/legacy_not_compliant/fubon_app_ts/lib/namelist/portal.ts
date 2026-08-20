/**
 * Portal（車公司回報 Web App）的共用常數。
 *
 * 分頁名與連結參數散在三支腳本裡改過兩次都漏改，改成單一來源。
 * 分頁名 2026-08-15 由「車輛司導回報」改為現值——旁邊多了 21 個以公司名命名的分頁後，
 * 舊名看起來像「其中一種回報」而不是總表。
 */
export const PORTAL_TAB = "回報紀錄（全部車公司）";

/** 專屬連結。⚠️ 參數用 t 不用 c：`c` 是 script.google.com 保留參數，Google 會回 400。 */
export const portalLinkFor = (base: string, token: string) => `${base}?t=${token}`;
