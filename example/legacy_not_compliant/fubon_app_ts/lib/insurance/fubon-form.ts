// 富邦「出團通知書」填單規格（Ina 2026-07-27 逐項確認）。
// 未來 Playwright 自動填單直接消費 buildFormPlan() 的輸出，固定值集中在此。

import type { Bucket } from "./classify.ts";
import { fubonFileName, medicalWan, exportBucket } from "./fubon-export.ts";

/** 全 JP 團固定值。 */
export const FUBON_FIXED = {
  費率名稱: "法定保障_各式附加條款(新)", // 按「選擇其他費率」跳窗後選這個（連帶決定保額選項）
  領隊導遊: "", // 留空
  領隊導遊證號: "",
  旅遊地區: ["東北亞", "日本", "日本"] as const, // 三格下拉固定
  交通工具: ["遊覽車"] as const, // 永遠勾遊覽車
  醫療費用萬: 20, // 一律 20 萬
  名冊上傳方式: "c", // c.上傳 word/PDF/其他格式（用 PDF）
} as const;

/** 西元 YYYY-MM-DD → 民國 "民國年/MM/DD"（西元−1911）。 */
export function toRocDate(ymd: string): string {
  const m = (ymd ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) throw new Error(`日期格式無法解析：${ymd}`);
  const roc = parseInt(m[1], 10) - 1911;
  return `${roc}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

/** 一個桶要填進富邦表單的完整內容。 */
export interface FubonFormPlan {
  團號: string;
  領隊導遊: string;
  領隊導遊證號: string;
  旅遊團員: string; // 名單裡的真人姓名（不可為空或 "-"）
  旅遊團員人數: number;
  旅遊地區: readonly string[];
  出發日民國: string; // 如 "115/07/28"
  旅遊天數: number; // 1 / 2 / 3…（自動換算結束日）
  交通工具: readonly string[];
  死亡失能萬: number; // 250 / 500
  醫療費用萬: number; // 20
  名冊上傳方式: string; // "c"
  名冊檔名: string; // 上傳的 PDF 檔名（= 團號.pdf）
}

/** 由分好的桶建出富邦填單計畫。 */
export function buildFormPlan(bucket: Bucket): FubonFormPlan {
  const e = exportBucket(bucket); // 內含旅遊團員(真人)、人數、團號、保額檢查
  const dep = bucket.departureDate ?? "";
  return {
    團號: e.groupNo,
    領隊導遊: FUBON_FIXED.領隊導遊,
    領隊導遊證號: FUBON_FIXED.領隊導遊證號,
    旅遊團員: e.leadName,
    旅遊團員人數: e.headCount,
    旅遊地區: FUBON_FIXED.旅遊地區,
    出發日民國: toRocDate(dep),
    旅遊天數: bucket.tourDays,
    交通工具: FUBON_FIXED.交通工具,
    死亡失能萬: bucket.coverageWan,
    醫療費用萬: medicalWan(),
    名冊上傳方式: FUBON_FIXED.名冊上傳方式,
    名冊檔名: `${fubonFileName(bucket)}.pdf`, // 官方命名：MMDD JP Nday 保額
  };
}
