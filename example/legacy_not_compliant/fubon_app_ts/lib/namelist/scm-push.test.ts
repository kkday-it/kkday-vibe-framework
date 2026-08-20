import { test } from "node:test";
import assert from "node:assert/strict";
import { pushReminders, scmHost, scmSessionFile, orderUrl, cookieFromState, SCM_PROD, SCM_STAGE } from "./scm-push.ts";

const item = {
  label: "30651 嵐山｜A車", orderMid: "26KK000000001", scenario: "司兼導" as const,
  name: "山田太郎", phoneCountryCode: "81", phoneNumber: "9012345678",
  plateNumber: "品川300あ12-34", tourLanguage: "zh-tw",
};

/** 假的 SCM：記下收到的請求，依腳本回應。 */
function fakeScm(script: { read?: any; write?: any; readBack?: any }) {
  const seen: { url: string; body?: any }[] = [];
  let reads = 0;
  const f = (async (url: string, init?: any) => {
    seen.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (init?.method === "POST") return { status: 200, json: async () => script.write ?? { result: true, data: { result_code: "0000" } } } as any;
    reads++;
    const body = reads === 1 ? script.read : (script.readBack ?? script.read);
    return { status: 200, json: async () => body } as any;
  }) as unknown as typeof fetch;
  return { f, seen };
}

const readWith = (guide: any) => ({ result: true, data: { preTripStatus: "INCOMPLETE", meetUp: { type: "MEETING", locations: [] }, driverGuide: guide, otherReminder: "" } });

test("預設打 stage；要打正式台必須明講 SCM_HOST=prod", () => {
  assert.equal(scmHost({} as any), SCM_STAGE);
  assert.equal(scmHost({ SCM_HOST: "1" } as any), SCM_STAGE);        // 手滑值不算
  assert.equal(scmHost({ SCM_HOST: "stage" } as any), SCM_STAGE);
  assert.equal(scmHost({ SCM_HOST: "prod" } as any), SCM_PROD);
  assert.equal(scmSessionFile({} as any), ".scm-stage-session.json");
  assert.equal(scmSessionFile({ SCM_HOST: "prod" } as any), ".scm-session.json");
  // 🔴 訂單頁的路徑是 /order/index/<編號>；用 orderlist?orderMid= 點進去會停在搜尋頁
  // 並顯示「無法找到該訂單」——連結看起來有效，實際上每個人都得再搜一次（Ina 2026-08-19）
  assert.equal(orderUrl("26KK1", {} as any), "https://scm.stage.kkday.com/v1/zh-tw/order/index/26KK1");
  assert.equal(orderUrl("26KK1", { SCM_HOST: "prod" } as any), "https://scm.kkday.com/v1/zh-tw/order/index/26KK1");
});

test("🔴 payload 不含 meetUp，而且帶回既有的 tourGuidePersonOid", async () => {
  const { f, seen } = fakeScm({ read: readWith({ tourGuidePersonOid: 267556, identity: "DRIVER", name: "舊的人" }),
                                readBack: readWith({ name: "山田太郎" }) });
  const [r] = await pushReminders([item], { cookie: "c=1", env: {} as any, fetchImpl: f });
  const posted = seen.find((s) => s.body)!.body;
  assert.equal("meetUp" in posted, false);
  assert.equal(posted.driverGuide.tourGuidePersonOid, 267556);
  assert.equal(r.ok, true);
  assert.match(r.note, /已寫入：司機山田太郎/);
});

test("🔴 回 0000 但讀回來沒變 → 算失敗，不能報成功", async () => {
  const { f } = fakeScm({ read: readWith({ tourGuidePersonOid: 1, name: "舊的人" }),
                          readBack: readWith({ name: "舊的人" }) });
  const [r] = await pushReminders([item], { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.note, /沒生效/);
});

test("寫入被拒要講出 result_code，不要吞掉", async () => {
  const { f } = fakeScm({ read: readWith(null), write: { result: false, msg: "boom", data: { result_code: "9999" } } });
  const [r] = await pushReminders([item], { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.note, /9999/);
});

test("讀不到現況就不寫 —— 沒有既有 oid 會安靜地沒生效", async () => {
  const { f, seen } = fakeScm({ read: { result: false, msg: "訂單資料不存在" } });
  const [r] = await pushReminders([item], { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.equal(seen.some((s) => s.body), false);   // 完全沒送出
});

test("一筆掛掉不影響其他筆", async () => {
  let n = 0;
  const f = (async (url: string, init?: any) => {
    if (String(url).includes("26KK000000002") && !init?.method) throw new Error("timeout");
    if (init?.method === "POST") return { status: 200, json: async () => ({ result: true, data: { result_code: "0000" } }) } as any;
    n++;
    return { status: 200, json: async () => readWith(n === 1 ? { tourGuidePersonOid: 5 } : { name: "山田太郎" }) } as any;
  }) as unknown as typeof fetch;
  const res = await pushReminders(
    [item, { ...item, orderMid: "26KK000000002" }, { ...item, orderMid: "26KK000000003" }],
    { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(res.length, 3);
  assert.equal(res[1].ok, false);
  assert.match(res[1].note, /讀取失敗/);
});

test("cookieFromState 只留 kkday 網域", () => {
  const ck = cookieFromState({ cookies: [
    { name: "a", value: "1", domain: ".scm.stage.kkday.com" },
    { name: "b", value: "2", domain: "accounts.google.com" },
  ] });
  assert.equal(ck, "a=1");
});

test("🔴 內容沒變就不重寫 —— 每存一次 SCM 就通知客人一次", async () => {
  const same = {
    tourGuidePersonOid: 99, identity: "DRIVER", name: "山田太郎", serviceLangs: ["zh-tw"],
    phone: { countryCode: "81", number: "9012345678" }, ims: [],
    vehicle: { plateNumber: "品川300あ12-34", color: "", model: "" },
  };
  const { f, seen } = fakeScm({ read: readWith(same) });
  const [r] = await pushReminders([item], { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.match(r.note, /已經是最新/);
  assert.equal(seen.some((s) => s.body), false);   // 一個字都沒送出去
});

test("換了司機就要寫 —— 只差一個欄位也算不同", async () => {
  const cur = {
    tourGuidePersonOid: 99, identity: "DRIVER", name: "山田太郎", serviceLangs: ["zh-tw"],
    phone: { countryCode: "81", number: "9099999999" }, ims: [],   // ← 電話不同
    vehicle: { plateNumber: "品川300あ12-34", color: "", model: "" },
  };
  const { f, seen } = fakeScm({ read: readWith(cur), readBack: readWith({ name: "山田太郎" }) });
  const [r] = await pushReminders([item], { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(seen.some((s) => s.body), true);
  assert.equal(seen.find((s) => s.body)!.body.driverGuide.tourGuidePersonOid, 99);
});

test("依供應商分組並先切 context", async () => {
  const calls: string[] = [];
  const f = (async (url: string, init?: any) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).includes("current-management")) {
      // 24276 切得過去，24278 切不過去
      return { status: String(url).endsWith("/24276") ? 200 : 403, json: async () => ({}) } as any;
    }
    if (init?.method === "POST") return { status: 200, json: async () => ({ result: true, data: { result_code: "0000" } }) } as any;
    return { status: 200, json: async () => readWith({ name: "山田太郎", tourGuidePersonOid: 7 }) } as any;
  }) as unknown as typeof fetch;

  const res = await pushReminders(
    [{ ...item, orderMid: "26KK1", supplierOid: 24276 },
     { ...item, orderMid: "26KK2", supplierOid: 24278 }],
    { cookie: "c=1", token: "tok", env: {} as any, fetchImpl: f });

  assert.equal(res.find((r) => r.orderMid === "26KK1")!.ok, true);
  // 切不過去的那家仍然照目前 context 試 —— 站錯供應商時讀不到會自己跳過，不會寫錯地方
  assert.equal(calls.some((c) => c.includes("current-management/24278")), true);
});

test("沒有權杖時不切、但照舊嘗試 —— 讀得到就寫得進去", async () => {
  const f = (async (url: string, init?: any) => {
    if (init?.method === "POST") return { status: 200, json: async () => ({ result: true, data: { result_code: "0000" } }) } as any;
    return { status: 200, json: async () => readWith({ name: "山田太郎", tourGuidePersonOid: 3 }) } as any;
  }) as unknown as typeof fetch;
  const [r] = await pushReminders([{ ...item, supplierOid: 24276 }],
    { cookie: "c=1", env: {} as any, fetchImpl: f });
  assert.equal(r.ok, true);
});

test("切供應商先打 v1 的 login_supplier —— 通了就不必開瀏覽器（RD 2026-08-20 指路）", async () => {
  const switched: number[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    // 2026-08-20 stage 實測的真實回應——**不是** { data: { … } }，是這個形狀
    if (String(url).includes("login_supplier")) {
      return new Response(JSON.stringify({ result: true, msg: "SUCCESS", data: { result_code: "0000" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { orderMid: "X" } }), { status: 200 });
  }) as unknown as typeof fetch;
  await pushReminders(
    [{ orderMid: "A1", label: "甲", supplierOid: 1894, scenario: "司兼導", name: "山田",
       phoneCountryCode: "81", phoneNumber: "9012345678", imType: "", imAccount: "", contacts: [],
       plateNumber: "", serviceLangs: ["zh-tw"] } as any],
    { cookie: "c", token: "t", fetchImpl, switcher: async (oid) => { switched.push(oid); return true; } },
  );
  assert.equal(calls.some((u) => u.includes("login_supplier")), true);
  // 這條通了就不該再開瀏覽器（那要好幾秒），也不該打 SCM 2.0 那支（會回 200 + L001）
  assert.deepEqual(switched, []);
  assert.equal(calls.some((u) => u.includes("current-management")), false);
});

test("login_supplier 沒成功才退回瀏覽器切換器 —— 那條是唯一實測 12/12 成功過的路", async () => {
  const switched: number[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    // v1 的錯誤是包在 200 的 body 裡的（L001「工作階段已過期」），不是靠狀態碼
    if (String(url).includes("login_supplier")) {
      return new Response(JSON.stringify({ metadata: { code: "L001", desc: "工作階段已過期" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { orderMid: "X" } }), { status: 200 });
  }) as unknown as typeof fetch;
  await pushReminders(
    [{ orderMid: "A1", label: "甲", supplierOid: 1894, scenario: "司兼導", name: "山田",
       phoneCountryCode: "81", phoneNumber: "9012345678", imType: "", imAccount: "", contacts: [],
       plateNumber: "", serviceLangs: ["zh-tw"] } as any],
    { cookie: "c", token: "t", fetchImpl, switcher: async (oid) => { switched.push(oid); return true; } },
  );
  assert.deepEqual(switched, [1894]);
  // 伺服器端那支切換 API 不該再被打（它會 403）
  assert.equal(calls.some((u) => u.includes("current-management")), false);
});

test("🔴 回 200 但是首頁 HTML → 必須當失敗（路徑打錯時 SCM 就是這樣回的）", async () => {
  // 假的成功比失敗危險得多：站錯供應商時每一張單都回「訂單資料不存在」，
  // 跟「這張單真的不存在」是同一個訊息（8/18、8/19 兩次全滅都是這樣誤判的）。
  const { loginSupplier } = await import("./scm-push.ts");
  const html = (async () => new Response("<!DOCTYPE html><html><head>…", { status: 200 })) as unknown as typeof fetch;
  assert.equal(await loginSupplier(24278, { cookie: "c", fetchImpl: html }), false);
  const notOk = (async () => new Response(JSON.stringify({ result: false, msg: "FAIL" }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await loginSupplier(24278, { cookie: "c", fetchImpl: notOk }), false);
  const ok = (async () => new Response(JSON.stringify({ result: true, data: { result_code: "0000" } }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await loginSupplier(24278, { cookie: "c", fetchImpl: ok }), true);
});
