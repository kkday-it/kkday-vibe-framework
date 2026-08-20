import { test } from "node:test";
import assert from "node:assert/strict";
import { uiSwitcher, SEARCH_SELECTOR } from "./scm-browser.ts";

/** 假的頁面：記下做過什麼，並讓測試決定「點完之後站在哪一家」。 */
function fakePage(opts: { has?: number[]; startOid?: number | null; after?: number | null }) {
  const acts: string[] = [];
  let oid = opts.startOid ?? 24276;
  return {
    acts,
    ops: {
      fill: async (sel: string, v: string) => { acts.push(`fill ${sel === SEARCH_SELECTOR ? "search" : sel} ${v}`); },
      clickOption: async (n: number) => {
        const ok = (opts.has ?? [n]).includes(n);
        if (ok) { acts.push(`click ${n}`); oid = opts.after === undefined ? n : opts.after; }
        return ok;
      },
      currentOid: async () => oid,
      wait: async () => {},
    },
  };
}

test("在頁首搜尋框打 OID 再點選 —— 這是 SCM 前端自己的做法（2026-08-19 實測可行）", async () => {
  const p = fakePage({ startOid: 24276 });
  assert.equal(await uiSwitcher(p.ops)(24278), true);
  assert.deepEqual(p.acts, ["fill search 24278", "click 24278"]);
});

test("已經站在那家就不重切 —— 切一次要好幾秒", async () => {
  const p = fakePage({ startOid: 24278 });
  assert.equal(await uiSwitcher(p.ops)(24278), true);
  assert.deepEqual(p.acts, []);
});

test("點完要回頭確認真的切過去了", async () => {
  // 點得到，但切完還站在原地（SCM 吃掉了那次點擊）→ 必須回 false
  const p = fakePage({ startOid: 24276, after: 24276 });
  assert.equal(await uiSwitcher(p.ops)(24278), false);
});

test("切換器裡找不到那家（沒有權限）→ 回 false，不是當成成功", async () => {
  const p = fakePage({ has: [], startOid: 24276 });
  assert.equal(await uiSwitcher(p.ops)(9999), false);
});

test("頁面爆掉也只回 false —— 讀不到的那幾張會被跳過，不會寫錯地方", async () => {
  const ops = {
    fill: async () => { throw new Error("page closed"); },
    clickOption: async () => true,
    currentOid: async () => 1,
    wait: async () => {},
  };
  assert.equal(await uiSwitcher(ops)(24278), false);
});
