// 執行：node --test lib/insurance/captcha.test.ts
// 用真實富邦驗證碼裁圖（純數字，無個資）驗證本地 OCR。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCaptchaSolver } from "./captcha.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const solver = await createCaptchaSolver();
after(() => solver.close());

test("OCR 認出富邦 4 位數字驗證碼", async () => {
  assert.equal(await solver.solve(join(dir, "captcha_0275.png")), "0275");
  assert.equal(await solver.solve(join(dir, "captcha_7313.png")), "7313");
});
