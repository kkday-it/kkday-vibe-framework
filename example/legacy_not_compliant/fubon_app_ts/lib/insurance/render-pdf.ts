// 把富邦名冊 HTML（bucketToHtml）用 headless chromium 印成 PDF，供表單上傳。
// 與官方 0727 PDF 對版一致（A4、含小計人數表頭）。

import { chromium, type Browser } from "playwright";
import type { Bucket } from "./classify.ts";
import { bucketToHtml } from "./fubon-pdf.ts";

/** 開一顆可重複使用的 headless 瀏覽器（多桶共用，省啟動成本）。 */
export async function openRenderer(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/** 把一桶名冊印成 PDF，寫到 outPath。回傳 outPath。 */
export async function renderBucketPdf(
  browser: Browser,
  bucket: Bucket,
  grandTotal: number,
  outPath: string,
): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setContent(bucketToHtml(bucket, grandTotal), { waitUntil: "load" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    return outPath;
  } finally {
    await page.close();
  }
}
