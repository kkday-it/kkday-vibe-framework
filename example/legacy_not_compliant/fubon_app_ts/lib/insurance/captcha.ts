// 富邦登入圖形驗證碼的本地 OCR（4 位數字）。用 tesseract.js，個資/畫面不外送。
// 搭配「換一張」重試迴圈即可達零人工：OCR→試登入→失敗就換一張再辨。

import { createWorker, type Worker } from "tesseract.js";

export interface CaptchaSolver {
  /** 辨識驗證碼圖（檔路徑或影像 Buffer），回傳純數字字串。 */
  solve(image: string | Buffer): Promise<string>;
  /** 用完釋放 worker。 */
  close(): Promise<void>;
}

/** 建立一個可重複使用的驗證碼辨識器（載入一次 OCR 模型）。 */
export async function createCaptchaSolver(): Promise<CaptchaSolver> {
  const worker: Worker = await createWorker("eng");
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789", // 只認數字
    // 單行模式（PSM 7）：驗證碼是一行數字
    tessedit_pageseg_mode: "7" as unknown as never,
  });
  return {
    async solve(image) {
      const { data } = await worker.recognize(image);
      return data.text.replace(/\D/g, "");
    },
    async close() {
      await worker.terminate();
    },
  };
}
