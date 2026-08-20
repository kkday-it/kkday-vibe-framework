// 用覆核號碼(secSubId)抓真保險證明書 PDF（唯讀,不重複投保）。
// 需一個「已登入」的富邦 page（主框架）。流程:上方選單 TLQUERY 申報查詢 → 填覆核號碼查詢
//   → 結果頁 doPrint 開列印選單窗 → 直接 POST query.do?actionType=print(FATL03) 抓 PDF bytes。

import { writeFileSync } from "node:fs";
import type { Page, Frame } from "playwright";

const BASE = "https://b2b.518fb.com";

/** 進入 TLQUERY 申報查詢頁(lower frame)。 */
async function openQuery(page: Page): Promise<Frame> {
  const upper = page.frames().find((f) => f.name() === "upper");
  await upper?.evaluate(() => { (document as any).T5359Form?.submit(); });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 15; i++) {
    const q = page.frames().find((f) => f.url().includes("query.do") && f.name() === "lower");
    if (q) { await q.waitForSelector('[name="secSubId"]', { timeout: 8000 }).catch(() => {}); return q; }
    await page.waitForTimeout(500);
  }
  throw new Error("進不了申報查詢頁");
}

/**
 * 抓單一覆核號碼的保險證明書,存到 outPath。回傳是否成功。
 * page 須為已登入的富邦主框架頁。
 */
export async function fetchCertByNo(page: Page, certNo: string, outPath: string): Promise<boolean> {
  const q = await openQuery(page);
  await q.fill('[name="secSubId"]', "").catch(() => {});
  await q.fill('[name="secSubId"]', certNo.toUpperCase());
  await q.click('input[value="開始查詢"]');

  const printBtn = q.locator("input[onclick*='doPrint']").first();
  await printBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  if (!(await printBtn.count())) { console.warn(`  補印 ${certNo}:查無資料`); return false; }

  // 按列印 → 列印選單窗
  const optP = page.context().waitForEvent("page", { timeout: 12000 }).catch(() => null);
  await printBtn.click();
  const opt = await optP;
  if (!opt) { console.warn(`  補印 ${certNo}:選單窗沒開`); return false; }
  await opt.waitForLoadState("domcontentloaded").catch(() => {});
  await opt.waitForTimeout(1200);

  // 蒐集表單欄位,強制 printVerCode=FATL03(純證明書)、不含名冊
  const formData = await opt.evaluate(() => {
    const f = document.getElementById("form") as HTMLFormElement | null;
    const data: Record<string, string> = {};
    if (f) for (const el of Array.from(f.querySelectorAll("input")) as HTMLInputElement[]) {
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      if (el.name) data[el.name] = el.value;
    }
    data["printVerCode"] = "FATL03";
    delete data["printNamelist"];
    return data;
  });
  const resp = await opt.request.post(`${BASE}/cas/tl/query.do?actionType=print`, { form: formData });
  const buf = await resp.body();
  const isPdf = (resp.headers()["content-type"] || "").includes("pdf") || buf.slice(0, 4).toString() === "%PDF";
  if (!opt.isClosed()) await opt.close().catch(() => {});
  if (!isPdf) { console.warn(`  補印 ${certNo}:回傳非 PDF`); return false; }
  writeFileSync(outPath, buf);
  console.log(`  📑 保險證明書 → ${outPath}（${buf.length} bytes）`);
  return true;
}
