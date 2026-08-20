/**
 * 把司導資訊寫進 SCM 的「行前提醒」——客人在 App／憑證上看到的就是這裡。
 *
 * 🔴 **這是唯一一個會讓客人立刻收到通知的動作**（存檔即發），所以：
 *   - 預設打 **stage**，要打正式台必須明講 `SCM_HOST=prod`（不是設個 1 就過）
 *   - 一律先讀後寫，讀不到就跳過那張單，不硬送
 *   - 只看 HTTP 200 不算成功，要 `result_code === "0000"`
 *   - 寫完再讀一次核對姓名，**確認真的進去了**——SCM 會在該拒絕的時候回成功（見下）
 *
 * 兩個 2026-08-17 在 stage 實測踩到、不照做就會出事的點：
 *  ① **payload 不要有 `meetUp` 這個 key。** 帶著送 SCM 會先刪集合地點再重建；
 *     送 null 直接清掉；整個 key 不送 → 客人的集合地點連碰都不會被碰。
 *  ② **已經有司導資料的訂單，要把既有的 `tourGuidePersonOid` 帶回去。**
 *     送 null 會回 `0000` 但**什麼都沒改**。對「事後換司機」是致命的：
 *     AM 換了人、程式回報成功、客人看到的還是舊的那個。
 *
 * 沒有批次端點（陣列 → Server Error、逗號分隔 → 查無訂單）→ 一張一次，逐筆記結果。
 */
import { buildScmReminder, assertNoMeetUp, pickWritable, REMINDER_PATH, REMINDER_READ_PATH, type ReminderInput } from "./scm-reminder.ts";

export const SCM_STAGE = "https://scm.stage.kkday.com";

/**
 * SCM 對「這張單不屬於你目前管理的供應商」回的訊息，跟「這張單真的不存在」**一模一樣**。
 * SCM 一次只服務一家供應商，所以同一張單換個 session 讀，結果可能完全相反
 * （2026-08-18 17:00 那批四張全 T101，八分鐘後重新登入再讀就全部讀得到）。
 *
 * → 全部都讀不到時要當成**這次登入沒切到對的供應商**，不能報成「訂單不存在」，
 *   後者會讓人跑去找 RD 查資料，而真正該做的只是重登一次。
 */
export const NOT_EXIST = "訂單資料不存在";
export const SCM_PROD = "https://scm.kkday.com";

/** 預設 stage。要打正式台得明白寫 `SCM_HOST=prod`——「1」這種手滑值不算。 */
export function scmHost(env = process.env): string {
  return env.SCM_HOST === "prod" ? SCM_PROD : SCM_STAGE;
}
export function scmSessionFile(env = process.env): string {
  return env.SCM_HOST === "prod" ? ".scm-session.json" : ".scm-stage-session.json";
}

/**
 * 一張訂單在 SCM 上的網址——貼進 Slack 讓人點進去看。
 *
 * 🔴 用 **`/order/index/<訂單編號>`**，不是 `orderlist?orderMid=`（Ina 2026-08-19 實測）。
 * 後者點進去會停在搜尋頁、還顯示「無法找到該訂單」——連結看起來有效，
 * 但每一個要查單的人都得再手動搜一次，等於這個連結沒有用。
 */
export function orderUrl(orderMid: string, env = process.env): string {
  return `${scmHost(env)}/v1/zh-tw/order/index/${encodeURIComponent(orderMid)}`;
}

export type PushItem = ReminderInput & {
  label: string;
  /** 這張單屬於哪家供應商（來自 DAP 的「供應商編號 Supplier OID」）。 */
  supplierOid?: number;
};

/**
 * API gateway 的網域**跟著 SCM 站台走**（2026-08-18 實測）：
 * stage 是 `api-gateway.stage.kkday.com`、正式是 `api-gateway.kkday.com`。
 *
 * 🔴 這裡原本寫死正式站，於是在 stage 切供應商必定失敗——而失敗的樣子是
 * 「每一張單都讀不到」，跟「訂單真的不存在」一模一樣。8/18 那天 17:00 全滅
 * 就是這個原因，當時被歸咎到「伺服器端被 403 擋」。
 */
export function gatewayHost(env = process.env): string {
  return scmHost(env).includes("stage") ? "https://api-gateway.stage.kkday.com" : "https://api-gateway.kkday.com";
}

/** 切換供應商 context。只認 Authorization，不吃 cookie（所以要登入時存下來的權杖）。 */
export const SWITCH_URL = (oid: number, env = process.env) =>
  `${gatewayHost(env)}/api-scm/api/external/v1/user/suppliers/current-management/${oid}`;

/**
 * ⭐ **v1 站自己的切換供應商端點**（RD 2026-08-20 指路）。
 *
 * 為什麼這條才對：我們回填走的 `order/update_pre_trip_reminder` 是 v1 站的傳統
 * cookie session（`s_ci_sessions`）。上面那支 gateway 端點屬於 **SCM 2.0 external API**，
 * 那套要 `Authorization: Bearer` **再加** `s-ci-sessions` 這個自訂標頭（簽章過的 session 值，
 * 2.0 前端存在 localStorage、從 cookie 看不到）——少了它 middleware 就回 200 + L001
 * 「工作階段已過期」，那正是我們卡了兩天的那個回應。
 *
 * 這支跟回填在**同一組 route、同一套認證**，base path 完全一樣，換 endpoint 就好。
 * 於是 CORS 與「兩套憑證」兩個問題同時消失，也不需要為了切換去開一個瀏覽器。
 */
export const LOGIN_SUPPLIER_PATH = "/api/v1/zh-tw/user/login_supplier";

/**
 * 用 v1 的 cookie session 切供應商。切不過去回 false（呼叫端要當失敗，見 switchSupplier）。
 *
 * ⚠️ SCM 的 v1 介面回 200 不代表成功——錯誤是包在 body 裡的（L001 就是這樣）。
 *    所以除了狀態碼，還要看 body 有沒有錯誤碼。
 */
export async function loginSupplier(
  oid: number, opts: { cookie: string; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<boolean> {
  try {
    const host = scmHost(opts.env ?? process.env);
    const r = await (opts.fetchImpl ?? fetch)(`${host}${LOGIN_SUPPLIER_PATH}`, {
      method: "POST",
      headers: { cookie: opts.cookie, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ supplierOid: oid, locale: "zh-tw" }),
    });
    if (r.status < 200 || r.status >= 300) return false;
    const body = await r.text();
    /**
     * 🔴 **只認 `result:true` 加 `result_code:"0000"`，其他一律當失敗。**
     *
     * 不能只看狀態碼：路徑打錯時 SCM 會回 **200 加整份首頁 HTML**（實測過），
     * 而寬鬆的判斷會把那個當成「切成功了」——然後每一張單都讀不到，
     * 表現得跟「訂單不存在」一模一樣（8/18、8/19 兩次全滅就是這種誤判）。
     * 這裡寧可誤判成失敗：失敗會退回瀏覽器切換器，而假的成功會讓整批安靜地報廢。
     *
     * stage 實測（2026-08-20）成功時的回應：
     *   {"result":true,"msg":"SUCCESS","data":{"result_code":"0000"}}
     */
    let j: any;
    try { j = JSON.parse(body); } catch { return false; }   // 不是 JSON ＝ 不是這支端點的回應
    if (j?.result === false) return false;
    const code = String(j?.data?.result_code ?? j?.metadata?.code ?? j?.code ?? "");
    return code === "0000";
  } catch {
    return false;
  }
}

/**
 * 切到指定供應商。**切不過去就回 false，呼叫端要把那批當失敗，不能照寫**——
 * context 不對時寫入不會報錯，只會安靜地寫到別的地方或整批讀不到。
 */
export async function switchSupplier(
  oid: number, opts: { token: string; cookie: string; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<boolean> {
  if (!opts.token) return false;
  try {
    const r = await (opts.fetchImpl ?? fetch)(SWITCH_URL(oid, opts.env), {
      method: "PUT",
      headers: { authorization: `Bearer ${opts.token}`, cookie: opts.cookie, "content-type": "application/json" },
    });
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}
export type PushResult = {
  orderMid: string;
  label: string;
  ok: boolean;
  /** 給人看的一句話：成功寫了什麼、或為什麼沒寫 */
  note: string;
  url: string;
};

type Fetcher = typeof fetch;

/**
 * SCM 上現在的司導資訊，跟我們要寫的是不是同一份。
 * 只比我們自己負責的欄位——`tourGuidePersonOid` 是 SCM 給的，不算差異。
 * ims 用「平台＋帳號」排序後比，順序不同不算改動。
 */
export function sameGuide(cur: any, next: any): boolean {
  if (!cur || !cur.name) return false;
  const ims = (v: any) => (v?.ims ?? []).map((x: any) => `${x.platform}:${x.id}`).sort().join("|");
  return String(cur.name ?? "") === next.name
    && String(cur.identity ?? "") === next.identity
    && String(cur.phone?.countryCode ?? "") === next.phone.countryCode
    && String(cur.phone?.number ?? "") === next.phone.number
    && String(cur.vehicle?.plateNumber ?? "") === next.vehicle.plateNumber
    && (cur.serviceLangs ?? []).join(",") === next.serviceLangs.join(",")
    && ims(cur) === ims(next);
}

/**
 * 逐筆推送。任何一筆失敗都不中斷其他筆——九台車不該因為第三台掛掉就全停。
 * cookie 由呼叫端給（Playwright 存下來的 storageState 轉成標頭）。
 */
export async function pushReminders(
  items: PushItem[],
  opts: {
    cookie: string; token?: string; env?: NodeJS.ProcessEnv; fetchImpl?: Fetcher;
    /**
     * 怎麼切供應商。**有給就用它**（正常是 scm-browser 的頁面版，能過 403）；
     * 沒給才退回伺服器端那支——留著是為了單元測試與沒有瀏覽器的環境。
     */
    switcher?: (oid: number) => Promise<boolean>;
  },
): Promise<PushResult[]> {
  const env = opts.env ?? process.env;
  const f = opts.fetchImpl ?? fetch;
  const host = scmHost(env);
  const out: PushResult[] = [];

  /**
   * **先照供應商分組再處理**。SCM 一次只服務一家供應商，一張一張切會多打很多次
   * 切換 API；而且同一家的單本來就該一起做完。沒有 supplierOid 的（例如走
   * SCM 匯出 CSV 那條路）歸在一組，維持原本行為：用目前的 context 直接試。
   */
  const groups = new Map<number | undefined, PushItem[]>();
  for (const it of items) groups.set(it.supplierOid, [...(groups.get(it.supplierOid) ?? []), it]);

  for (const [oid, group] of groups) {
    if (oid !== undefined) {
      /**
       * 切供應商的三條路，**依可靠度排序**（2026-08-20 依 RD 指路重排）：
       *   ① `login_supplier`：v1 站自己的端點，跟回填同一套 cookie session。
       *      不用瀏覽器、不用第二組憑證、沒有 CORS——所以先試這條。
       *   ② 瀏覽器切換器：原本的做法（開頁面點選單）。留著當備援，
       *      因為它是唯一實測 12/12 成功過的路，而 ① 是今天才接上的。
       *   ③ gateway 那支：屬於 SCM 2.0，缺 `s-ci-sessions` 標頭會回 200 + L001。
       *      留著只為了「萬一哪天前兩條都不行」，實務上不預期會成功。
       */
      let how = "";
      let okSwitch = await loginSupplier(oid, { cookie: opts.cookie, fetchImpl: f, env });
      if (okSwitch) how = "login_supplier";
      else if (opts.switcher && await opts.switcher(oid)) { okSwitch = true; how = "瀏覽器切換器"; }
      else if (!opts.switcher) {
        okSwitch = await switchSupplier(oid, { token: opts.token ?? "", cookie: opts.cookie, fetchImpl: f, env });
        if (okSwitch) how = "gateway";
      }
      if (okSwitch) console.log(`  ↔️ 已切到供應商 ${oid}（${how}）`);
      /**
       * 切不過去就**照目前的 context 試**，不要整組放棄。
       *
       * 2026-08-18 實測：切換那支 API 從伺服器端打會被擋（403），只有在瀏覽器頁面內
       * 送才過得去。在還沒把切換搬進 Playwright 之前，目前的 context 本來就常常是對的
       * （SCM 記得上次選的那家），硬要全部擋掉等於把原本會成功的也一起弄失敗。
       *
       * 真的站錯供應商時，下面的「先讀後寫」會讀不到而跳過那張單——
       * **不會寫錯地方**，只會沒寫。所以退回去試是安全的。
       */
      if (!okSwitch) {
        console.log(`  ⚠️ 切不到供應商 ${oid}${opts.token ? "（API 從伺服器端被擋）" : "（沒有權杖）"}`
          + " → 改用目前的 context 試；讀不到的那幾張會被跳過，不會寫錯地方。");
      }
    }
  for (const it of group) {
    const url = orderUrl(it.orderMid, env);
    const fail = (note: string) => out.push({ orderMid: it.orderMid, label: it.label, ok: false, note, url });

    // ── 先讀。讀不到就跳過：沒有既有 oid 就寫，第二次起會安靜地沒生效
    let existing: ReturnType<typeof pickWritable>;
    try {
      const r = await f(`${host}${REMINDER_READ_PATH}?orderMid=${encodeURIComponent(it.orderMid)}`,
        { headers: { cookie: opts.cookie, accept: "application/json" } });
      const j = (await r.json()) as any;
      if (!j?.result) { fail(`讀不到現況（${j?.msg || r.status}）→ 沒寫`); continue; }
      existing = pickWritable(j);
    } catch (e) {
      fail(`讀取失敗：${String((e as Error).message).slice(0, 80)} → 沒寫`); continue;
    }

    const dg = (existing.driverGuide ?? {}) as any;
    const payload = buildScmReminder({ ...it, existingGuideOid: dg.tourGuidePersonOid ?? null });
    assertNoMeetUp(payload, it.orderMid);

    /**
     * 🔴 **內容沒變就不要寫。** SCM 每存一次檔就**發一次通知給客人**——
     * 補跑、手動重跑、同一天跑第二次，客人就會收到第二封一模一樣的通知。
     * 對客人來說那是騷擾，而且會讓人以為司導又換人了。
     * 比對的是我們負責的那幾個欄位，不是整包（SCM 自己會補 oid、時間之類的東西）。
     */
    if (sameGuide(dg, payload.driverGuide)) {
      out.push({ orderMid: it.orderMid, label: it.label, ok: true, url,
        note: `已經是最新的（${payload.driverGuide.name}）→ 不重寫，避免再通知客人一次` });
      continue;
    }

    // ── 寫
    let code = "";
    try {
      const r = await f(`${host}${REMINDER_PATH}`, {
        method: "POST",
        headers: { cookie: opts.cookie, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as any;
      code = j?.data?.result_code ?? String(r.status);
      if (!(r.status === 200 && j?.result && code === "0000")) {
        fail(`寫入被拒（result_code ${code}${j?.msg ? "：" + String(j.msg).slice(0, 60) : ""}）`); continue;
      }
    } catch (e) {
      fail(`寫入失敗：${String((e as Error).message).slice(0, 80)}`); continue;
    }

    // ── 再讀核對。SCM 會在「該拒絕」的時候回 0000，所以成功碼不能當證據
    try {
      const r = await f(`${host}${REMINDER_READ_PATH}?orderMid=${encodeURIComponent(it.orderMid)}`,
        { headers: { cookie: opts.cookie, accept: "application/json" } });
      const j = (await r.json()) as any;
      const after = (pickWritable(j).driverGuide ?? {}) as any;
      if (after.name !== payload.driverGuide.name) {
        fail(`回 0000 但**沒生效**（讀回來的姓名不是剛剛寫的）→ 需要人工確認`); continue;
      }
      out.push({
        orderMid: it.orderMid, label: it.label, ok: true, url,
        note: `已寫入：${payload.driverGuide.identity === "DRIVER" ? "司機" : "導遊"}${payload.driverGuide.name}`
          + `${payload.driverGuide.phone.number ? "／電話有" : "／⚠️沒電話"}`
          + `${payload.driverGuide.vehicle.plateNumber ? `／${payload.driverGuide.vehicle.plateNumber}` : ""}`,
      });
    } catch (e) {
      fail(`寫了但核對讀不到：${String((e as Error).message).slice(0, 60)} → 請人工確認`);
    }
  }
  }
  return out;
}

/**
 * storageState → 前端的存取權杖（切換供應商用）。
 *
 * Playwright 存 session 時**連 localStorage 一起存了**，所以不必改登入流程、
 * 也不必再開一次瀏覽器——舊的 session 檔一樣讀得到。
 * ⚠️ 這個值等同帳號權限：只在記憶體裡用，不要印出來、不要寫進 log。
 */
export function tokenFromState(state: { origins?: { origin: string; localStorage?: { name: string; value: string }[] }[] }): string {
  for (const o of state.origins ?? []) {
    for (const kv of o.localStorage ?? []) {
      if (kv.name === "access-token" && /^eyJ/.test(kv.value)) return kv.value;
    }
  }
  return "";
}

/** Playwright storageState → Cookie 標頭（只留 kkday 網域的）。 */
export function cookieFromState(state: { cookies?: { name: string; value: string; domain: string }[] }): string {
  return (state.cookies ?? [])
    .filter((c) => /kkday\.com$/.test(c.domain.replace(/^\./, "")))
    .map((c) => `${c.name}=${c.value}`).join("; ");
}
