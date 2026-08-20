/**
 * 在**瀏覽器頁面裡**切換 SCM 的供應商——用 SCM 自己的切換器（頁首搜尋框 → 點選）。
 *
 * ## 為什麼是點畫面，不是打 API（2026-08-19 實測定案）
 *
 * 切換那支 API 兩條路都不通：
 *   ① 從伺服器端打 `api-gateway`：補上 `locale` 後回 200，但內容是 **L001 工作階段已過期**。
 *   ② 改在已登入的頁面裡 `fetch`：被 **CORS** 擋（gateway 不回 SCM 網域的 preflight）。
 *
 * 但 SCM 前端自己切是通的——所以就照人的做法做：**在頁首搜尋框打 OID → 點那個選項**。
 * 8/19 實測：從「日本專屬團-九州」切到「日本專屬團-北海道 (24278)」，
 * 切完 `current-management` 回的就是北海道，而原本讀不到的訂單立刻讀得到。
 *
 * ⚠️ 一定要**比對括號裡的 OID 再點**。早期版本用模糊文字比，切到別家供應商而不自知——
 * 而站錯家的下場不是「寫錯地方」，是**整批讀不到**：SCM 一次只服務一家供應商，
 * 站錯時每一張單都回「訂單資料不存在」，跟「這張單真的不存在」是同一個訊息。
 * 8/18 與 8/19 17:00 兩次全滅都是這樣來的，當下還被誤判成 stage 沒有資料。
 *
 * 用的是登入時存下來的 storageState（跟 scm-login-sso 同一份），**不會另外要帳密**。
 */
import { chromium, type Browser, type Page } from "playwright";

/** 一個「切到某家供應商」的函式。切不過去回 false。 */
export type Switcher = (oid: number) => Promise<boolean>;

/** 頁首那個搜尋框可能的長相——SCM 改版時從這裡加，不要散在程式各處。 */
export const SEARCH_SELECTOR =
  'input[type="search"], input[placeholder*="搜"], input[placeholder*="供應商"], input[placeholder*="Search"]';

/**
 * 用畫面切供應商。抽成只依賴幾個小動作，是為了能單獨測——
 * 測試不用真的開瀏覽器，傳進來的是「會做這些事的東西」。
 */
export function uiSwitcher(page: {
  fill: (sel: string, v: string) => Promise<void>;
  clickOption: (oid: number) => Promise<boolean>;
  currentOid: () => Promise<number | null>;
  wait: (ms: number) => Promise<void>;
}): Switcher {
  return async (oid) => {
    try {
      // 已經站在這家就不用切（切一次要好幾秒，而多數日子只有一家）
      if (await page.currentOid() === oid) return true;
      await page.fill(SEARCH_SELECTOR, String(oid));
      await page.wait(2500);
      if (!(await page.clickOption(oid))) {
        console.log(`  ⚠️ 供應商 ${oid} 在切換器裡找不到（沒有權限？）→ 這次不切`);
        return false;
      }
      await page.wait(6000);
      /**
       * 🔴 **點完要回頭確認真的切過去了**，不能因為「點得到」就當成功。
       * 沒確認的話，切失敗會表現成「那批單全部讀不到」——看起來像訂單有問題。
       */
      const now = await page.currentOid();
      if (now !== oid) {
        console.log(`  ⚠️ 點了 ${oid}，但現在站的是 ${now ?? "讀不到"} → 當作沒切成功`);
        return false;
      }
      return true;
    } catch (e) {
      console.log(`  ⚠️ 切供應商 ${oid} 失敗：${String((e as Error).message).slice(0, 80)}`);
      return false;
    }
  };
}

/** 從頁面實際做那幾個動作。`current-management` 的回應用攔的，不另外打 API（會被擋）。 */
function pageOps(page: Page, seen: { oid: number | null }) {
  return {
    fill: async (sel: string, v: string) => {
      const box = page.locator(sel).first();
      await box.waitFor({ state: "visible", timeout: 20000 });
      await box.fill(v);
    },
    clickOption: async (oid: number) => {
      const opt = page.getByText(new RegExp(`\\(${oid}\\)`)).first();
      if (!(await opt.count())) return false;
      await opt.click({ force: true });
      return true;
    },
    currentOid: async () => seen.oid,
    wait: (ms: number) => page.waitForTimeout(ms),
  };
}

/**
 * 開一個帶著登入狀態的 SCM 分頁，把 switcher 交給 `fn` 用，結束時關掉。
 *
 * ⚠️ 只在**本機**跑得動：SCM 在雲端被 CloudFront 擋（403）。**不是 VPN 的問題**——
 * SCM 不需要 VPN，擋的是來源地區／機房（2026-08-19 實測：從美國節點連 www.kkday.com 也 403）
 *（見 project_scm_push_local_only）。所以呼叫端要能接受「開不起來」——
 * 那時退回原本的行為（用目前的 context 試），不要整批放棄。
 */
export async function withScmSwitcher<T>(
  opts: { sessionFile: string; host: string; headless?: boolean },
  fn: (sw: Switcher | undefined) => Promise<T>,
): Promise<T> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  const seen: { oid: number | null } = { oid: null };
  try {
    browser = await chromium.launch({ headless: opts.headless !== false });
    const ctx = await browser.newContext({ storageState: opts.sessionFile });
    page = await ctx.newPage();
    // 目前站在哪一家：SPA 自己會打這支，攔它的回應就好——我們自己打會被 gateway 擋
    page.on("response", async (r) => {
      if (!/current-management/.test(r.url())) return;
      try { seen.oid = JSON.parse(await r.text())?.data?.supplierOid ?? seen.oid; } catch { /* 不是 JSON 就算了 */ }
    });
    await page.goto(`${opts.host}/v2/zh-tw/general/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    console.log(`  ⚠️ 開不起 SCM 分頁（${String((e as Error).message).slice(0, 80)}）→ 這次不切供應商，用目前的 context 試`);
    await browser?.close().catch(() => {});
    return fn(undefined);
  }
  try {
    return await fn(uiSwitcher(pageOps(page, seen)));
  } finally {
    await browser?.close().catch(() => {});
  }
}
