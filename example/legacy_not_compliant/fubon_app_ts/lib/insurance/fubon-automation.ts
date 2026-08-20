// 富邦 B2B「出團通知書」自動填單驅動（Playwright，專案級非 MCP）。
// 零人工：登入驗證碼走本地 OCR + 換一張重試迴圈；逐桶依 buildFormPlan 填單。
// 富邦是 legacy jQuery frameset → 一律用 waitForSelector（不可用 networkidle，會逾時）。

import type { Page } from "playwright";
import type { Bucket } from "./classify.ts";
import { buildFormPlan } from "./fubon-form.ts";
import { FUBON_FIELD, FUBON_OPTION, FUBON_LOGIN, FUBON_RATE } from "./fubon-selectors.ts";
import type { CaptchaSolver } from "./captcha.ts";

const WAIT = 20_000; // legacy 頁面較慢，給寬鬆逾時

/** 登入所需帳密（全部由環境變數提供，勿寫進 repo）。 */
export interface FubonCreds {
  company: string; // 公司別，如 "eApply1-111"
  user: string;
  password: string;
  birthday: string; // 登入生日 7 碼，如 "0900401"
}

/** 從環境變數讀登入帳密。 */
export function fubonCredsFromEnv(env = process.env): FubonCreds {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`缺少環境變數 ${k}`);
    return v;
  };
  return {
    company: env.FUBON_COMPANY || "eApply1-111",
    user: need("FUBON_USER"),
    password: need("FUBON_PASSWORD"),
    birthday: env.FUBON_BIRTHDAY || "", // 新版登入頁已無生日欄，選填
  };
}

const g = (name: string) => `[name="${name}"]`;

/**
 * 登入富邦 B2B：填公司別/帳號/密碼(逐字)/生日 → OCR 驗證碼 → 送出。
 * 失敗（驗證碼錯）就「換一張」重辨，最多 maxTries 次，達零人工。
 */
export async function fubonLogin(
  page: Page,
  creds: FubonCreds,
  solver: CaptchaSolver,
  opts: { maxTries?: number } = {},
): Promise<void> {
  const maxTries = opts.maxTries ?? 10; // 換一張免費，多試幾次讓真送更穩
  await page.goto(FUBON_LOGIN.網址, { waitUntil: "domcontentloaded", timeout: WAIT });

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    await page.waitForSelector(g(FUBON_LOGIN.帳號), { timeout: WAIT });
    // 公司別（unionNum，登入頁預設已帶 eApply1-111）：值不對才補，確保正確
    const unionCur = await page.inputValue(g(FUBON_LOGIN.公司別)).catch(() => "");
    if (unionCur !== creds.company) {
      await page.fill(g(FUBON_LOGIN.公司別), creds.company);
    }
    // 帳號
    await page.fill(g(FUBON_LOGIN.帳號), creds.user);
    // 密碼欄被程式填會被清空 → 逐字鍵入
    const pw = page.locator(g(FUBON_LOGIN.密碼));
    await pw.click();
    await pw.fill("");
    await pw.pressSequentially(creds.password, { delay: 60 });
    // 新版登入頁無生日欄（creds.birthday 保留相容但登入不再使用）

    // 截驗證碼圖 → OCR
    const captchaImg = page.locator(FUBON_LOGIN.驗證碼圖).first();
    const buf = await captchaImg.screenshot();
    const code = await solver.solve(buf);
    await page.fill(g(FUBON_LOGIN.驗證碼), code);

    await page.click(FUBON_LOGIN.登入按鈕);

    // 送出後富邦跳生日彈窗（新規）：填 7 碼生日 → 按確認登入
    const modal = await page
      .waitForSelector(FUBON_LOGIN.生日彈窗, { timeout: 6000, state: "visible" })
      .then(() => true)
      .catch(() => false);
    if (modal) {
      if (!creds.birthday) throw new Error("登入需要生日（FUBON_BIRTHDAY），但未提供");
      await page.fill(FUBON_LOGIN.生日, creds.birthday);
      await page.click(FUBON_LOGIN.生日確認登入按鈕);
    }

    // 判斷是否登入成功：登入後轉為 frameset，出現名為 "lower" 的框架即成功
    const ok = await page
      .waitForSelector(`frame[name="${FUBON_LOGIN.下框架名}"]`, { timeout: WAIT })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      await page.waitForTimeout(1500); // 等 lower frame 內容載入
      return;
    }

    // 失敗 → 換一張驗證碼再試（換不到就重整登入頁）
    console.warn(`登入第 ${attempt} 次失敗（驗證碼 OCR="${code}"），換一張重試…`);
    const refreshed = await page
      .click(FUBON_LOGIN.換一張, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!refreshed) {
      await page.goto(FUBON_LOGIN.網址, { waitUntil: "domcontentloaded", timeout: WAIT });
    }
  }
  throw new Error(`登入失敗：驗證碼 OCR 重試 ${maxTries} 次仍未成功`);
}

/**
 * 從登入後 lower frame 點「旅行業責任保險」選單 → 開 SSO popup 出團通知書表單。
 * 回傳那個 popup 頁（fillNotifyForm 在它上面填單）。每桶各開一個新 popup。
 */
export async function gotoNotifyForm(page: Page): Promise<Page> {
  const lower = page.frames().find((f) => f.name() === FUBON_LOGIN.下框架名);
  if (!lower) throw new Error("找不到 lower frame（登入後選單框架）");
  await lower.waitForSelector(FUBON_LOGIN.選單_旅責險, { timeout: WAIT });
  const popupP = page.context().waitForEvent("page", { timeout: WAIT });
  await lower.click(FUBON_LOGIN.選單_旅責險);
  const popup = await popupP;
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  await popup.waitForURL(`**/${FUBON_LOGIN.表單頁網址片段}**`, { timeout: WAIT }).catch(() => {});
  await popup.waitForSelector(g(FUBON_FIELD.團號), { timeout: WAIT });
  return popup;
}

/**
 * 選費率：按「選擇其他費率」開費率窗 → 點「法定保障_各式附加條款(新)」列 → 回填母表單。
 * 前置條件：出發日/結束日/旅遊地區已填（否則 popQuery alert 擋住）。
 */
async function selectRate(page: Page): Promise<void> {
  // popQuery 是 toggle：winOpen 已有值會關窗，故先歸零確保是「開窗」
  await page.evaluate(() => { try { (window as any).winOpen = null; } catch (e) {} });
  await page.click(g(FUBON_FIELD.選擇其他費率按鈕), { timeout: WAIT });

  // 等我們要的費率窗出現（summit=Y，非表單載入時自動開的舊窗 summit=N）
  let rate: Page | undefined;
  for (let i = 0; i < 20 && !rate; i++) {
    rate = page.context().pages().find(
      (p) => p.url().includes(FUBON_RATE.窗網址片段) && p.url().includes(FUBON_RATE.正確窗標記),
    );
    if (!rate) await page.waitForTimeout(400);
  }
  if (!rate) throw new Error("費率窗未開啟（確認出發日/結束日/旅遊地區已填）");
  await rate.waitForLoadState("domcontentloaded").catch(() => {});
  await rate.waitForSelector('a[href*="selectAgency"]', { timeout: WAIT });

  // 點 tyGrpCname 前綴為「法定保障_各式附加條款(新)」的列（排除「來台人士_…」）
  const clicked = await rate.evaluate((cname) => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="selectAgency"]'));
    const target = links.find((a) => (a.getAttribute("href") || "").includes(`,'${cname}'`));
    if (!target) return false;
    target.click(); // javascript:selectAgency → window.opener.selectAgency 回填母表單
    return true;
  }, FUBON_RATE.費率別名稱);
  if (!clicked) throw new Error(`費率窗找不到「${FUBON_RATE.費率別名稱}」列`);

  // 等母表單 agencyName 被回填（selectAgency 完成）
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      return !!el && el.value.trim().length > 0;
    },
    g(FUBON_FIELD.旅行社),
    { timeout: WAIT },
  ).catch(() => {});
  // 收掉所有費率窗（含表單載入時自動彈的 summit=N 舊窗），避免多桶累積干擾
  for (const p of page.context().pages()) {
    if (p !== page && p.url().includes(FUBON_RATE.窗網址片段) && !p.isClosed()) {
      await p.close().catch(() => {});
    }
  }
}

/**
 * 逐桶填「出團通知書」：費率→團號/代表人/人數→地區→出發日/天數→交通→保額→上傳 PDF→下一步。
 * dryRun=true（預設）填到複核頁就停，不真送；由 Ina 督看第一次。
 * 回傳是否「已送出」。
 */
export async function fillNotifyForm(
  page: Page,
  bucket: Bucket,
  pdfPath: string,
  opts: { dryRun?: boolean; screenshotPath?: string; diagDir?: string } = {},
): Promise<{ submitted: boolean; confirmed?: boolean; certNo?: string; premium?: string }> {
  const dryRun = opts.dryRun ?? true;
  const plan = buildFormPlan(bucket);

  // 1. 團號 / 代表人 / 人數
  await page.fill(g(FUBON_FIELD.團號), plan.團號);
  await page.fill(g(FUBON_FIELD.旅遊團員代表人), plan.旅遊團員);
  await page.fill(g(FUBON_FIELD.旅遊團員人數), String(plan.旅遊團員人數));

  // 2. 國家地區＝東北亞（A40101）→ 等 travelArea ajax → 旅遊地區選「日本」
  await page.selectOption(g(FUBON_FIELD.國家地區), FUBON_OPTION.國家地區_東北亞);
  await page.waitForTimeout(1000); // 等 ajax 載入 travelArea 選項
  await page
    .selectOption(g(FUBON_FIELD.旅遊地區), { label: FUBON_OPTION.旅遊地區_日本文字 })
    .catch(() => {});

  // 3. 出發日（民國）＋天數 → 按自動算結束日（先於費率，popQuery 需要日期）
  await page.fill(g(FUBON_FIELD.出發日), plan.出發日民國);
  await page.selectOption(g(FUBON_FIELD.出發時), "00").catch(() => {});
  await page.fill(g(FUBON_FIELD.天數), String(plan.旅遊天數));
  await page.click(g(FUBON_FIELD.自動算結束日按鈕)).catch(() => {});
  await page.waitForTimeout(600);

  // 3.5 選費率「法定保障_各式附加條款(新)」（須在日期/地區之後）
  await selectRate(page);

  // 4. 交通工具＝遊覽車（value 4）。check 後驗證，沒勾成就用原生 click 觸發 onclick/onchange
  const busSel = `${g(FUBON_FIELD.交通工具)}[value="${FUBON_OPTION.交通工具_遊覽車}"]`;
  await page.check(busSel).catch(() => {});
  const busOk = await page.isChecked(busSel).catch(() => false);
  if (!busOk) {
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el && !el.checked) el.click(); // 觸發 showTransInfo/overseaShipOnly250
    }, busSel);
  }
  if (!(await page.isChecked(busSel).catch(() => false))) {
    throw new Error("交通工具『遊覽車』勾選失敗");
  }

  // 5. 死亡失能（依保額）＋醫療 20 萬
  await page.selectOption(g(FUBON_FIELD.死亡失能), FUBON_OPTION.死亡失能[plan.死亡失能萬]);
  await page.selectOption(g(FUBON_FIELD.醫療費用), FUBON_OPTION.醫療費用[plan.醫療費用萬]);

  // 6. 名冊方式 K（預設）＋上傳 PDF（選項 c，免按上傳鈕）
  await page.setInputFiles(g(FUBON_FIELD.名冊檔_PDF其他), pdfPath);

  // 7. 下一步 → 複核頁（捕捉驗證 alert，若有代表某必填沒過）
  const alerts: string[] = [];
  const onDialog = async (d: import("playwright").Dialog) => {
    alerts.push(d.message());
    await d.accept().catch(() => {});
  };
  page.on("dialog", onDialog);
  await page.click(g(FUBON_FIELD.下一步按鈕), { timeout: WAIT });
  await page.waitForTimeout(2500); // 等導頁或 alert
  page.off("dialog", onDialog);
  if (alerts.length) {
    throw new Error(`下一步被驗證擋住：${alerts.join(" / ")}`);
  }

  // 複核頁抓保費（如「保險費 836元(每人44元)」）。金額由 JS 算出，雲端較慢時
  // 抓的當下可能還沒算好 → 輪詢等它出現（最多 ~6s），否則會抓到空字串。
  let premium = "";
  for (let i = 0; i < 20 && !premium; i++) {
    premium = await page.evaluate(() => {
      const t = (document.body.innerText || "").replace(/\s+/g, "");
      const m = t.match(/保險費([\d,.]+元(?:[（(][^）)]*[）)])?)/);
      return m ? m[1] : "";
    }).catch(() => "");
    if (!premium) await page.waitForTimeout(300);
  }

  if (dryRun) {
    if (opts.screenshotPath) {
      await page.screenshot({ path: opts.screenshotPath, fullPage: true }).catch(() => {});
    }
    console.log(`【dry-run】桶 ${plan.團號} 已填至複核頁，未送出。保費：${premium || "?"}`);
    return { submitted: false, premium };
  }
  // 複核頁直接送出（Ina 確認：不用再勾選）→ 進「交易成功」頁。捕捉送出時的 alert。
  const submitAlerts: string[] = [];
  const onSubmitDialog = async (d: import("playwright").Dialog) => {
    submitAlerts.push(d.message());
    await d.accept().catch(() => {});
  };
  page.on("dialog", onSubmitDialog);
  await page.click(
    "input[value*='進行儲存'], input[value*='下一步'], input[type='submit'], button[type='submit']",
    { timeout: WAIT },
  );
  await page.waitForTimeout(3500); // 等交易成功頁
  page.off("dialog", onSubmitDialog);

  // 驗證「真的成功」：送出跳 alert，或頁面仍停在複核（沒有交易成功跡象）→ 視為失敗，不誤報。
  if (submitAlerts.length) {
    throw new Error(`送出被擋：${submitAlerts.join(" / ")}`);
  }
  const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, "");
  // 備援：若複核頁沒抓到保費，改從交易成功頁再抓一次（用共用 parsePremium，見 premium.ts）
  if (!premium && bodyText) {
    const { parsePremium } = await import("./premium.ts");
    const p = parsePremium(bodyText);
    if (p) premium = p;
  }
  // 先抓覆核號碼（secSubId）— 這是成功送出後才有的保單識別碼，也是最可靠的成功證據。
  const certNo = await page.evaluate(() => {
    const m = document.documentElement.innerHTML.match(/secSubId"\s*:\s*"([^"]+)"/);
    return m ? m[1] : "";
  }).catch(() => "");
  // 成功判定：有覆核號 或 頁面有交易成功字樣，即確定成功（覆核號最硬）。
  const looksSuccess = Boolean(certNo) || /交易成功|投保成功|保單號|年保單號|列印/.test(bodyText);
  // 仍停在複核頁 且 無成功跡象（含無覆核號）→ 沒送成功。
  const stillOnReview = /確認申報資料|進行儲存/.test(bodyText) && !looksSuccess;
  if (stillOnReview) {
    throw new Error("送出後仍停在複核頁，未見交易成功頁（可能被驗證擋住）");
  }
  if (!looksSuccess) {
    // 既無覆核號也無成功字樣：仍算已點送出，但警示需人工核對（避免漏記→重跑重複投保）。
    console.warn(`  ⚠️ 桶 ${plan.團號} 已送出但未取得覆核號/成功字樣，請以診斷/截圖人工確認。`);
  }

  // 存交易成功頁診斷（供校正/佐證）
  if (opts.diagDir) await dumpSuccessPageDiag(page, opts.diagDir).catch(() => {});
  return { submitted: true, confirmed: looksSuccess, certNo, premium };
}

/**
 * 首次真送用：把「交易成功」頁的實況全存下來（HTML/截圖/frames/候選列印連結），
 * 供現場校正保單下載 selector。存到 diagDir，不影響主流程。
 */
export async function dumpSuccessPageDiag(page: Page, diagDir: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  try {
    mkdirSync(diagDir, { recursive: true });
    writeFileSync(join(diagDir, "交易成功頁.html"), await page.content().catch(() => ""), "utf-8");
    await page.screenshot({ path: join(diagDir, "交易成功頁.png"), fullPage: true }).catch(() => {});
    // 列出所有 frame + 每個 frame 內含「列印/保單/PDF/證明」字樣的可點元素
    const lines: string[] = [`URL: ${page.url()}`, `title: ${await page.title().catch(() => "")}`, ""];
    for (const f of page.frames()) {
      const html = await f.content().catch(() => "");
      lines.push(`=== frame name=${f.name()} url=${f.url()} ===`);
      const cands = html.match(/<(a|input|button|img)[^>]*(列印|保單|保險證明|PDF|print|Print|download)[^>]*>/gi);
      if (cands) lines.push(...cands.slice(0, 15).map((c) => "  " + c.replace(/\s+/g, " ")));
      const onclicks = html.match(/onclick="[^"]{0,100}"/gi);
      if (onclicks) lines.push(...[...new Set(onclicks)].slice(0, 15).map((c) => "  onclick: " + c));
      // 該 frame 若有另開視窗/表單，記下 action
      const forms = html.match(/<form[^>]*action="[^"]*"[^>]*>/gi);
      if (forms) lines.push(...forms.slice(0, 8).map((c) => "  " + c.replace(/\s+/g, " ")));
    }
    writeFileSync(join(diagDir, "交易成功頁_候選元素.txt"), lines.join("\n"), "utf-8");
    console.log(`  🔍 交易成功頁診斷已存 → ${diagDir}`);
  } catch (e) {
    console.warn("  ⚠️ 交易成功頁診斷失敗：", (e as Error).message);
  }
}

/**
 * 「交易成功」頁下載保險證明書 PDF。富邦手動流程是按「列印」→存 PDF。
 * 列印鈕常會另開可列印視窗 → 抓那視窗印成 PDF；否則退而印當前成功頁。
 * ⚠️ 交易成功頁 DOM 尚未實勘（要真送一次才有），selector 首次真送時校正。
 * 傳 diagDir 會先 dump 交易成功頁實況（首次真送建議帶）。
 */
export async function downloadCertificate(page: Page, outPath: string, diagDir?: string): Promise<string | null> {
  if (diagDir) await dumpSuccessPageDiag(page, diagDir);
  const printSel =
    "#printBtn, [onclick*='printCer'], " + // 交易成功頁實勘：列印保險證明書鈕
    "input[value*='列印保險證明書'], a:has-text('列印'), input[value*='列印'], button:has-text('列印'), " +
    "a:has-text('列印保單'), a:has-text('保險證明'), [onclick*='print'], [onclick*='Print']";
  const printBtn = page.locator(printSel).first();
  const hasPrint = await printBtn.count().then((c) => c > 0).catch(() => false);

  if (hasPrint) {
    // 按 printCer：開「列印選單窗」（同 session，token 有效）→ 選「保險證明書」→ 按列印 → 抓證明書
    const popupP = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await printBtn.click().catch(() => {});
    const optWin = await popupP; // 列印選單窗（choose 證明書/收據/名冊）
    if (optWin) {
      await optWin.waitForLoadState("domcontentloaded").catch(() => {});
      await optWin.waitForTimeout(1200);
      // 存選單窗診斷（供校正）
      if (diagDir) {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        try {
          mkdirSync(diagDir, { recursive: true });
          writeFileSync(join(diagDir, "列印選單窗.html"), await optWin.content().catch(() => ""), "utf-8");
          await optWin.screenshot({ path: join(diagDir, "列印選單窗.png"), fullPage: true }).catch(() => {});
        } catch { /* ignore */ }
      }
      // 選「保險證明書」radio（非「+收據+繳費」、非「名冊」）；找不到就用預設
      await optWin.getByText("保險證明書", { exact: true }).click({ timeout: 3000 }).catch(() => {});
      // 按選單窗的「列印」→ 可能再開證明書視窗
      const certP = optWin.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
      await optWin.getByRole("button", { name: /列印/ }).click({ timeout: 3000 })
        .catch(async () => { await optWin.locator("input[value*='列印'], button:has-text('列印')").first().click({ timeout: 3000 }).catch(() => {}); });
      const certWin = await certP;
      const target = certWin ?? optWin; // 證明書視窗，否則退選單窗
      await target.waitForLoadState("domcontentloaded").catch(() => {});
      await target.waitForTimeout(1200);
      await target.pdf({ path: outPath, format: "A4", printBackground: true }).catch(() => {});
      if (certWin && !certWin.isClosed()) await certWin.close().catch(() => {});
      if (!optWin.isClosed()) await optWin.close().catch(() => {});
    } else {
      await page.pdf({ path: outPath, format: "A4", printBackground: true }).catch(() => {});
    }
    console.log(`  📑 保險證明書 → ${outPath}`);
    return outPath;
  }

  // 沒找到列印鈕：退而把成功頁印成 PDF（首次真送再依實況調整）
  console.warn("交易成功頁找不到『列印』鈕，暫存成功頁 PDF；首次真送時校正 selector。");
  await page.pdf({ path: outPath, format: "A4", printBackground: true }).catch(() => {});
  return outPath;
}
