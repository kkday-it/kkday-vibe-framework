// 每桶產出「富邦名冊檔」— 欄位照富邦出團通知書手動名冊 / Excel 上傳格式：
//   姓名、國籍、身分證字號、出生日期(YYYYMMDD)
// 供人工上傳到富邦（Excel 上傳或 PDF 附加），或直接對照手動輸入。

import type { Bucket, ClassifiedTraveler } from "./classify.ts";

/** 富邦名冊一列。 */
export interface FubonRosterRow {
  姓名: string;
  國籍: string;
  身分證字號: string;
  出生日期: string; // YYYYMMDD
}

/** 出發日 MMDD。 */
function depMMDD(bucket: Bucket): string {
  return (bucket.departureDate ?? "").replace(/[-/]/g, "").slice(4, 8);
}

/** 富邦「團號」欄格式：MMDD - {天數}D {保額}，如 "0728 - 1D 500"（表單內用）。 */
export function fubonGroupNo(bucket: Bucket): string {
  return `${depMMDD(bucket)} - ${bucket.tourDays}D ${bucket.coverageWan}`;
}

/** 上傳 PDF 檔名（不含副檔名）：MMDD JP {天數}day {保額}，如 "0703 JP 1day 250"（官方命名）。 */
export function fubonFileName(bucket: Bucket): string {
  return `${depMMDD(bucket)} JP ${bucket.tourDays}day ${bucket.coverageWan}`;
}

/** 醫療費用（萬）：一律 20 萬（Ina 2026-07-27 指定，不隨死亡失能保額變動）。 */
export function medicalWan(_coverageWan?: number): number {
  return 20;
}

/** 姓名：優先中文姓名，否則英文（姓 名）。 */
function fullName(t: ClassifiedTraveler): string {
  const local = [t.localLastName, t.localFirstName].filter(Boolean).join("");
  if (local) return local;
  return [t.enLastName, t.enFirstName].filter(Boolean).join(" ");
}

/** 國籍：TW → 本國，其餘暫用原碼（富邦手動欄位下拉，本國/外國）。 */
function nationality(t: ClassifiedTraveler): string {
  return (t.nationCode ?? "").toUpperCase() === "TW" ? "本國" : (t.nationCode ?? "");
}

/** 一個桶 → 富邦名冊列。 */
export function bucketToRoster(bucket: Bucket): FubonRosterRow[] {
  return bucket.travelers.map((t) => ({
    姓名: fullName(t),
    國籍: nationality(t),
    身分證字號: (t.twIdNo || t.passportNo || "").toUpperCase(), // 統一大寫
    出生日期: (t.birthday ?? "").replace(/[-/]/g, ""), // YYYYMMDD
  }));
}

/** 把名冊列輸出成 CSV 文字（含 BOM，Excel 開中文不亂碼）。 */
export function rosterToCsv(rows: FubonRosterRow[]): string {
  const header = ["姓名", "國籍", "身分證字號", "出生日期"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.姓名, r.國籍, r.身分證字號, r.出生日期].map(esc).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** 一個桶的完整投保摘要（給人工填富邦表單對照用）。 */
export interface FubonBucketExport {
  groupNo: string; // 團號
  coverageWan: number; // 死亡失能（萬）
  medicalWan: number; // 醫療費用（萬）
  tourDays: number;
  headCount: number;
  leadName: string; // 旅遊團員首位
  csv: string; // 富邦名冊 CSV
}

export function exportBucket(bucket: Bucket): FubonBucketExport {
  const rows = bucketToRoster(bucket);
  // 旅遊團員代表人 = 名單第一位有效姓名（依原始順序，非排序後）。
  // Ina：代表人一律填「英文」姓名（en_last + en_first），無英文才退中文。
  const first = bucket.travelers
    .map((t) => [t.enLastName, t.enFirstName].filter(Boolean).join(" ") ||
      [t.localLastName, t.localFirstName].filter(Boolean).join(""))
    .find((n) => n && n.trim() && n.trim() !== "-");
  if (!first) {
    throw new Error(`桶 ${fubonGroupNo(bucket)} 找不到可當旅遊團員的有效姓名`);
  }
  // 富邦「旅遊團員」欄不接受橫槓，名字裡的「-」要刪掉（否則無法送出）。
  const lead = first.replace(/-/g, "");
  return {
    groupNo: fubonGroupNo(bucket),
    coverageWan: bucket.coverageWan,
    medicalWan: medicalWan(bucket.coverageWan),
    tourDays: bucket.tourDays,
    headCount: bucket.travelers.length,
    leadName: lead,
    csv: rosterToCsv(rows),
  };
}
