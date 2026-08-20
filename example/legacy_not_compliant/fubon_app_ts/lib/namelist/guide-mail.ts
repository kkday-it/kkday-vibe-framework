/**
 * 寄名單給導遊：信件內容 + 「寄過就不再寄」台帳。
 *
 * 為什麼要台帳：重複寄名單會直接打擾到導遊本人（不像重複產檔只是浪費）。
 * 富邦投保已經用同一招防重複投保，這裡照搬。
 * key＝團號＋出發日＋收件人＋**第幾次寄** —— 同一團改派導遊時仍會寄給新的人，這是對的。
 *
 * 為什麼 key 要含「第幾次」（Ina 2026-08-06）：一天最多寄兩次——
 *   13:00 第一次：不管車公司填了沒都先寄，導遊要拿名單先打電話跟餐廳確認。
 *   16:00 第二次：**只有在第一次寄的時候還沒有司機資訊、現在有了**才補寄，信裡註明「本次已附司機資訊」。
 * 所以「已經寄過」要分次判斷，不能一律擋掉，否則補寄永遠寄不出去。
 *
 * ⚠️ **16:00 那一輪跑完就收工，之後不再自動寄任何東西**（Ina 2026-08-06 決定）。
 * 因為 16:00 起是 Winnie 的人工路徑：她自己問車公司 → LINE／WeChat 給導遊 → 事後才回填大表。
 * 機器人看不到她已經講過了，這時候再自動寄一封，導遊就被同一件事通知兩次。
 *
 * ⚠️ 這支不自己決定「該不該寄」。gate 在上層。
 */
import { shortPackages } from "./namelist-html.ts";
import { vehicleLine } from "./phone.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { BusGroup } from "./enrich.ts";
import { OPS_CC } from "./fnl.ts";
import { meaningfulSpecs, isCharter, shortCharterPlan } from "./guide-namelist.ts";

const LEDGER = ".guide-mail-sent.json";

/**
 * 寄件人：日本運営ツアーチーム 共用信箱（Ina 2026-08-15 選定）。
 * 用共用信箱而不是個人信箱，是因為導遊會直接回信問事情——
 * 回到共用信箱大家看得到，Ina 請假或轉調時這條線不會斷。
 * ⚠️ 真的要寄之前，這個帳號要授權一次 OAuth（GOOGLE_OAUTH_*），
 *    或讓執行的帳號有它的「代理寄件」權限。
 */
/**
 * 一格裡可能塞了好幾個信箱：換行、逗號、頓號、分號都有人用
 * （Kitaya 那格就是兩個地址用換行分隔，2026-08-15 實測）。
 * 直接把整格丟進 To 會產生壞掉的信頭，收件人一個都收不到。
 */
/**
 * 一格可能填了好幾個信箱（實測 23 家車公司裡有 5 家）→ 全部收下來，一次寄給所有人。
 *
 * **全形字要先轉半形**。2026-08-18 實查發現「357観光」填的是 `yuyang＠inmyshow.jp`
 * ——全形的 ＠。日文與中文輸入法很容易打出全形，而它長得跟半形幾乎一樣，
 * 肉眼看不出來。認不出來的後果不是報錯，是**那家車公司的名單永遠寄不出去**，
 * 而畫面上只寫「查不到車公司的信箱」，看起來像沒登記。
 *
 * 只轉 ＠ ．和全形逗號分號這幾個確定是輸入法造成的字；
 * 帳號本體不做任何猜測性的修正——猜錯會把信寄到別人手上。
 */
export function splitEmails(cell: string): string[] {
  return String(cell ?? "")
    .replace(/＠/g, "@").replace(/．/g, ".").replace(/[，；]/g, ",")
    .split(/[\n\r,;、\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}

/** 這一格是不是靠「全形轉半形」才救回來的 → 要提醒人去把來源改掉。 */
export function hadFullWidth(cell: string): boolean {
  return /[＠．，；]/.test(String(cell ?? ""));
}

export const GUIDE_MAIL_FROM = "日本運営ツアーチーム <jptour-operation@kkday.com>";

/**
 * 導遊信箱還沒確認完之前，**一封都不寄給導遊或車公司，全部轉寄給 Ina**
 * （Ina 2026-08-15）。目前 16 位導遊沒有信箱、名單還在補，這時候寄出去
 * 最好的情況是寄丟，最壞的情況是寄給錯的人——而名單裡有客人的個資。
 *
 * 為什麼做成「預設關、要開得明講」而不是靠 MAIL_TEST_TO：
 * MAIL_TEST_TO 是**有人記得設才生效**，漏設一次就真的寄出去，而信收不回來。
 * 這裡反過來——預設就轉寄，要真的寄給對方必須明確設 GUIDE_MAIL_GO_LIVE=1。
 * 兩個開關都要（GO_LIVE＋SEND_FOR_REAL），沒有任何一個單一疏忽會把信送到外面。
 */
export const REDIRECT_ALL_TO = "ina.huang@kkday.com";

/** true＝導遊信箱已確認完，可以真的寄給對方。預設 false。 */
export function guideMailGoLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GUIDE_MAIL_GO_LIVE ?? "").trim() === "1";
}

/**
 * 這封信實際要寄到哪裡。
 * 回傳 redirected=true 時，主旨一定要標【測試｜原收件人 …】，
 * 而且**不可以記台帳**——那不是真的寄給對方，記了會讓正式那封被當成寄過而跳過。
 */
export function resolveMailTo(
  realTo: string[], env: NodeJS.ProcessEnv = process.env,
): { to: string[]; redirected: boolean } {
  const testTo = (env.MAIL_TEST_TO ?? "").trim();
  if (testTo) return { to: [testTo], redirected: true };
  if (!guideMailGoLive(env)) return { to: [REDIRECT_ALL_TO], redirected: true };
  return { to: realTo, redirected: false };
}

/**
 * 對外的信一律 CC JP OP 共用信箱——**測試轉寄的也 CC**（Ina 2026-08-18）。
 * 理由是轉寄信的主旨已經掛了「【測試｜原收件人…】」，OP 看得出來不會誤動作；
 * 而讓 OP 從測試期就開始收，正式上線那天信流不會突然改變。
 *
 * ⚠️ 這是刻意的例外：其他所有「對外」動作（寄導遊、寄供應商、回填 SCM）
 * 在測試期都是不出去的。只有這個共用信箱是明確同意收測試信的收件人。
 * 個人信箱不適用——共用信箱不會離職也不會請假。
 */
export function guideMailCc(_redirected: boolean, cc = OPS_CC): string[] {
  return [cc];
}

export type Pass = 1 | 2;
export type SentRecord = {
  key: string; tourCode: string; date: string; to: string; at: string; subject: string;
  pass: Pass;
  /** 那一次寄出時名單上有沒有司機資訊——決定 16:00 要不要補寄 */
  hadVehicle: boolean;
};

const keyOf = (tourCode: string, date: string, to: string, pass: Pass) =>
  `${date}|${tourCode}|${to.trim().toLowerCase()}|p${pass}`;

export function loadLedger(path = LEDGER): Map<string, SentRecord> {
  if (!existsSync(path)) return new Map();
  try {
    const arr = JSON.parse(readFileSync(path, "utf8")) as SentRecord[];
    return new Map(arr.map((r) => [r.key, r]));
  } catch {
    // 台帳壞掉時**當成空的會重複寄** → 寧可擋下來讓人處理
    throw new Error(`寄送台帳 ${path} 讀不出來，為避免重複寄信已中止。請檢查或刪除該檔後重跑。`);
  }
}

export function alreadySent(
  ledger: Map<string, SentRecord>, tourCode: string, date: string, to: string, pass: Pass = 1,
): SentRecord | undefined {
  return ledger.get(keyOf(tourCode, date, to, pass));
}

/**
 * 共用硬碟版台帳：本機那份只要檔案沒了、或換一台機器跑，程式就會以為沒寄過而重寄，
 * 導遊被同一份名單打擾兩次（Ina 2026-08-15 要求搬上雲）。
 * 讀不出來一律中止——**當成空的等於保證重寄**，比停下來嚴重得多。
 */
export async function loadLedgerShared(): Promise<Map<string, SentRecord>> {
  const { readLedger } = await import("./drive-archive.ts");
  const arr = (await readLedger()) as SentRecord[];
  return new Map(arr.filter((r) => r && r.key).map((r) => [r.key, r]));
}

/** 寫回共用硬碟。呼叫端負責在每次真的寄出後呼叫。 */
export async function markSentShared(
  ledger: Map<string, SentRecord>, tourCode: string, date: string, to: string, subject: string,
  now: string, pass: Pass = 1, hadVehicle = false,
): Promise<void> {
  const key = keyOf(tourCode, date, to, pass);
  ledger.set(key, { key, tourCode, date, to, at: now, subject, pass, hadVehicle });
  const { writeLedger } = await import("./drive-archive.ts");
  await writeLedger([...ledger.values()]);
}

export function markSent(
  ledger: Map<string, SentRecord>, tourCode: string, date: string, to: string, subject: string,
  now: string, pass: Pass = 1, hadVehicle = false, path = LEDGER,
): void {
  const key = keyOf(tourCode, date, to, pass);
  ledger.set(key, { key, tourCode, date, to, at: now, subject, pass, hadVehicle });
  writeFileSync(path, JSON.stringify([...ledger.values()], null, 2), "utf8");
}

/**
 * 16:00 這一輪，這位導遊該不該補寄？三個條件都要成立：
 *   ① 13:00 那次確實寄出去了（沒寄過就不是「補寄」，該走第一次的流程）
 *   ② 那次寄的時候還沒有司機資訊
 *   ③ 現在有了
 * 不成立的情況一律不寄——重複打擾導遊比晚一點知道司機是誰嚴重。
 */
export function shouldResend(
  ledger: Map<string, SentRecord>, tourCode: string, date: string, to: string, hasVehicleNow: boolean,
): { resend: boolean; reason: string } {
  const first = alreadySent(ledger, tourCode, date, to, 1);
  if (!first) return { resend: false, reason: "13:00 那次沒寄成功 → 這輪應該當第一次寄，不是補寄" };
  if (alreadySent(ledger, tourCode, date, to, 2)) return { resend: false, reason: "已經補寄過了" };
  if (first.hadVehicle) return { resend: false, reason: "第一次就附了司機資訊，不用補寄" };
  if (!hasVehicleNow) return { resend: false, reason: "車公司到現在還是沒填 → 不補寄，改通知 Winnie 去催" };
  return { resend: true, reason: "第一次沒司機資訊、現在有了" };
}

/**
 * 這台車載的是哪些方案。
 *
 * 為什麼一定要寫進信裡（Ina 2026-08-18）：528834 那種團同一天會出兩台，
 * A+B 方案一台、C 方案（多採水果＋午餐）一台——兩封信除了團號以外**幾乎一模一樣**，
 * 而導遊沒辦法從團號看出差別在哪，等於要靠猜或回頭問。
 *
 * 同一台載多個方案時全部列出，用「／」分隔：那台車上真的有兩種行程的客人，
 * 只寫一個會讓導遊漏掉另一半人的餐食或加購。
 */
/**
 * 這台車的客人選了什麼（規格）。包車商品的路線就在這裡——
 * 方案名稱只寫得出「【6人成行｜專屬包車】」，看不出今天要去哪（Ina 2026-08-18）。
 */
export function busSpecs(bus: BusGroup): string[] {
  return [...new Set(bus.rows.flatMap((r) => meaningfulSpecs(r.specs)))];
}

/**
 * **信件**要不要寫規格：只有包車要（Ina 2026-08-18）。
 * 募集型的規格是票種，信裡寫了沒有意義；包車的規格是當天路線，非寫不可。
 * 名單 PDF 則兩種都印——那是現場對照用的，多一行不礙事。
 */
export function mailSpecs(bus: BusGroup): string[] {
  return bus.rows.some((r) => isCharter(r.productNo, r.packageName)) ? busSpecs(bus) : [];
}

export function planNames(bus: BusGroup): string[] {
  const raw: string[] = [];
  for (const r of bus.rows) {
    const n = String(r.packageName ?? "").trim();
    // 包車：只留「6人成行｜專屬包車」那段，後面那串可選清單跟商品名一樣長
    if (n) raw.push(isCharter(r.productNo, r.packageName) ? shortCharterPlan(n) : n);
  }
  /**
   * 用**跟名單同一套**的判斷去併（Ina 2026-08-19）。
   *
   * 原本這裡是逐字去重，於是同一條行程只要有人用簡體、或掛了不同的促銷標籤
   *（早鳥／晚鳥／買一送一／1人成團），信裡的「方案」就會列出三四行——
   * 導遊看了會以為車上有三四種行程。名單那邊早就會併了，信卻沒有，
   * 兩份文件講的是同一台車卻對不起來。
   *
   * 真的不同的方案（528834 的 Ｂ／Ｃ）照樣分開列——那是導遊現場要知道的差別。
   */
  return [...new Set(shortPackages(raw).values())];
}

export type GuideMailInput = {
  guideName: string;
  to: string;
  productName: string;
  productNo: string;
  departureDate: string;
  bus: BusGroup;
  /** 同行群組數，內文提醒導遊注意座位。 */
  companionGroups: number;
  /** 1＝13:00 第一次；2＝16:00 補上司機資訊後再寄一次 */
  pass?: Pass;
  /** 這次寄出的名單上有沒有車號／司機 */
  hasVehicle?: boolean;
  /** 這個行程用不用車。false＝沒有巴士（例 30651 嵐山走鐵道＋遊船）→ 信裡完全不提車。 */
  usesVehicle?: boolean;
  /**
   * 車號與司機。**傳結構，不要傳組好的字串**（Ina 2026-08-20）：
   * 那一行的標籤要跟著信的語言走，日文信不能寫「車號」「司機」。
   * 組法見 phone.vehicleLine。
   */
  vehicle?: { plate?: string; drivers?: { name?: string; phone?: string }[] };
  /** 這間車公司的 Portal 專屬連結；有就直接放進信裡讓對方自己填 */
  portalLink?: string;
  /**
   * 收件人是誰。**司兼導的名單寄車公司窗口，不是導遊**——兩種信的語氣與訴求完全不同：
   * 給導遊是「這是你明天的客人」，給車公司是「這是明天的客人，另外司導資訊記得給我」。
   */
  recipient?: "導遊" | "車公司";
};

/**
 * 主旨＝出發日、團號、商品名稱（Ina 2026-08-13 指定的順序）。
 * 團號放第二順位是因為導遊一天可能帶不只一團，用日期分不出來；商品名稱長，放最後才不會把前面擠掉。
 */
/** 顯示用的導遊稱呼：去掉「（モリヤマミンミン）」這類讀音註記與並列寫法，只留第一個名字。 */
export function displayGuide(raw: string): string {
  const first = String(raw ?? "").replace(/[（(][^）)]*[）)]/g, " ").split(/[／\/、,]/)[0];
  return first.trim() || "您";
}

/**
 * 純文字內文 → HTML。只做兩件事：換行保留、把網址收成一行可點的按鈕文字。
 * 車公司信裡那條 Portal 連結是 120 幾字的 Apps Script 網址，貼在信裡很嚇人
 * （Ina 2026-08-15）。純文字版仍保留完整網址——只收純文字的信箱要點得到。
 */
export function mailHtml(i: GuideMailInput, body: string): string {
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const lines = body.split("\n").map((l) => {
    const url = l.trim();
    if (i.portalLink && url === i.portalLink) {
      return `<p style="margin:14px 0"><a href="${esc(url)}" style="background:#1AB6C1;color:#fff;`
        + `padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">`
        + `貴公司專用表單（點這裡填寫）</a></p>`;
    }
    return `<div>${esc(l) || "&nbsp;"}</div>`;
  });
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#212121">${lines.join("")}</div>`;
}

export function mailSubject(i: GuideMailInput): string {
  const car = i.bus.carLetter ? `（${i.bus.carLetter} 車）` : "";
  const tag = i.pass === 2 ? "【更新·已附司機資訊】" : "";
  // 資訊還沒給的時候，主旨就要看得出來要回覆——車公司信箱多半是共用的，主旨決定會不會被點開
  const ask = i.recipient === "車公司" && !i.hasVehicle ? "【請回覆司導資訊】" : "";
  const tour = i.bus.tourCode || "團號未定";
  return `${tag}${ask}【KKday 專屬團】${i.departureDate}｜${tour}${car}｜${i.productName}`;
}


/**
 * 日文版（信件正文的主體）。收件人是日本的導遊與車公司，日文放前面最好讀；
 * 中文版接在下面，給我方窗口核對用（Ina 2026-08-15 決定日文為主）。
 * ⚠️ 兩個語言版本的**內容必須一致**——只翻譯，不在其中一邊多寫或少寫，
 *    否則兩邊對不上時沒有人知道哪個才算數。
 */
function guideBodyJa(i: GuideMailInput): string {
  const lines = [
    `${displayGuide(i.guideName)} ガイド様`,
    ``,
    // 商業書信の型：寒暄 → 本題 → ご査収。
    // 直訳調（「明日ご案内いただくツアーの参加者名簿をお送りいたします」）は
    // 中国語の語順がそのまま残って不自然（Ina 2026-08-15）。
    `平素より大変お世話になっております。`,
    ``,
    i.pass === 2
      ? `運転手の情報が確定いたしましたので、最新版の参加者名簿をお送りいたします。\n先にお送りした名簿は破棄くださいますようお願い申し上げます。`
      : `明日出発の下記ツアーにつきまして、参加者名簿をお送りいたします。\nご査収のほどよろしくお願い申し上げます。`,
    ``,
    `　出発日：${i.departureDate}`,
    `　商品番号：${i.productNo}`,
    `　コース：${i.productName}`,
    ...(planNames(i.bus).length ? [`　プラン：${planNames(i.bus).join("／")}`] : []),
    ...(mailSpecs(i.bus).length ? [`　当日コース：${mailSpecs(i.bus).join("／")}`] : []),
    `　ツアー番号：${i.bus.tourCode || "－"}${i.bus.carLetter ? `　車両：${i.bus.carLetter} 号車` : ""}`,
    `　参加人数：${i.bus.total} 名`,
  ];
  if (i.usesVehicle === false) {
    // 車を使わないコース → 車両の話は一切書かない
  } else if (i.hasVehicle) {
    lines.push(`　車両・運転手：${i.vehicle ? vehicleLine("ja", i.vehicle) : "名簿上部をご参照ください"}`);
  } else {
    lines.push(
      ``,
      `車両・運転手の情報はバス会社より未着のため、名簿には「運転手情報は本日中にご連絡」と表示しております。`,
      `バス会社から連絡があり次第、更新版の名簿をお送りします。夕方までに届かない場合は、KKday 担当より LINE／WeChat にてご連絡いたします。`,
    );
  }
  lines.push(``, `ご不明な点がございましたら、本メールへご返信いただくか、KKday 担当までお申し付けください。`,
    `何卒よろしくお願い申し上げます。`);
  return lines.join("\n");
}

/** 車公司（司兼導團）向け日文版。 */
function busCompanyBodyJa(i: GuideMailInput): string {
  const lines = [
    `${i.guideName || "ご担当者"} 様`,
    ``,
    `平素より大変お世話になっております。`,
    ``,
    // pass 2＝資訊補齊後的更新版。**主旨掛了【更新】內文也一定要講**——
    // 車公司信箱多半是共用的，同一天兩封幾乎一樣的信，不講清楚會有人照舊的那封做事
    //（2026-08-15 發現內文漏了這段，只有導遊那側有）。
    i.pass === 2
      ? `ガイド兼ドライバーの情報を頂戴しましたので、最新版の参加者名簿をお送りいたします。\n本メールの名簿をご利用ください。先にお送りした名簿は破棄くださいますようお願い申し上げます。`
      : `明日出発の下記ツアーにつきまして、参加者名簿をお送りいたします。\nガイド兼ドライバーの方へお渡しくださいますよう、よろしくお願い申し上げます。`,
    ``,
    `　出発日：${i.departureDate}`,
    `　商品番号：${i.productNo}`,
    `　コース：${i.productName}`,
    ...(planNames(i.bus).length ? [`　プラン：${planNames(i.bus).join("／")}`] : []),
    ...(mailSpecs(i.bus).length ? [`　当日コース：${mailSpecs(i.bus).join("／")}`] : []),
    `　ツアー番号：${i.bus.tourCode || "－"}${i.bus.carLetter ? `　車両：${i.bus.carLetter} 号車` : ""}`,
    `　参加人数：${i.bus.total} 名`,
  ];
  if (i.hasVehicle) {
    lines.push(``, `ガイド兼ドライバーと車両の情報は受領済みで、名簿上部に記載しております。相違がないかご確認ください。`);
  } else {
    lines.push(
      ``,
      // ⚠️ 收件人就是**該提供資訊的人** → 開頭要寫「尚未收到貴公司的資訊」，
      //    不能寫成「資訊還沒到，之後會有人給您」（那是寫給等待方的話）。Ina 2026-08-15 指正。
      `本ツアーのガイド兼ドライバーと車両の情報を、まだ頂戴しておりません。`,
      `恐れ入りますが、本日 16:00 までにご登録くださいますようお願い申し上げます。`,
      `（お客様へは 17:00 までにご案内する必要がございます。）`,
    );
    if (i.portalLink) lines.push(``, `ご登録は貴社専用フォームよりお願いいたします（ログイン不要・スマートフォン可）。`, i.portalLink);
  }
  lines.push(``, `ご不明な点がございましたら、本メールへご返信ください。`,
    `何卒よろしくお願い申し上げます。`);
  return lines.join("\n");
}

/** 語言之間的分隔線：讓日文段落與中文段落一眼分得開。 */
const LANG_SEP = "────────────────────────";

/** 給車公司窗口的信（司兼導團）。資訊給了就單純寄名單；還沒給就加上 16:00 的期限。 */
function busCompanyBody(i: GuideMailInput): string {
  const lines = [
    `${i.guideName || "貴公司"} 承辦人 您好，`,
    ``,
    i.pass === 2
      ? `已收到貴公司回報的司兼導資訊，附上更新版名單。請以本封為準，先前寄出的那份請勿再使用。`
      : `附上明日出團的旅客名單，敬請查收並轉交隨團司機（司兼導）：`,
    ``,
    `　出發日期：${i.departureDate}`,
    `　商品編號：${i.productNo}`,
    `　行程：${i.productName}`,
    ...(planNames(i.bus).length ? [`　方案：${planNames(i.bus).join("／")}`] : []),
    ...(mailSpecs(i.bus).length ? [`　當天路線：${mailSpecs(i.bus).join("／")}`] : []),
    `　團號：${i.bus.tourCode || "－"}${i.bus.carLetter ? `　車別：${i.bus.carLetter} 車` : ""}`,
    `　旅客人數：${i.bus.total} 位`,
  ];
  if (i.hasVehicle) {
    lines.push(``, `司機與車輛資訊已收到，名單上方已載明，請再確認一次是否正確。`);
  } else {
    // 對車公司講 16:00（不是 17:00）——17:00 是我們要把資訊給客人的期限，中間留一小時緩衝
    // 2026-08-15：改用純文字（信件不會 render markdown，`**` 只會變成礙眼的星號），
    // 並把**貴公司專屬連結直接放進信裡**——車公司收到信就能填，不必等 AM 轉貼。
    // QR 圖的說法 2026-08-14 已作廢，客人改點加好友連結。
    lines.push(
      ``,
      // 這段原本每行開頭是「※」加全形縮排，在郵件軟體裡對不齊（Ina 2026-08-15）→ 改一般段落
      `本團的司兼導與車輛資訊尚未收到貴公司回報。`,
      `煩請於今日 16:00 前提供司兼導姓名、聯絡電話、車號。`,
      i.portalLink
        ? `請直接從貴公司專用表單填寫（免登入，手機可填）：\n${i.portalLink}`
        : `請直接回覆本信告知。`,
      `我們需要在 17:00 前將司導資訊提供給旅客，逾時將由專人聯繫貴公司確認。`,
    );
  }
  lines.push(``, `如有疑問請直接回覆本信。`);
  return lines.join("\n");
}

/** 內文刻意短：導遊多半在手機上看，重點是人數、集合注意事項、附件。 */
export function mailBody(i: GuideMailInput): string {
  // 日文為主、中文在下（Ina 2026-08-15）。署名只放一次，放在最後面。
  const ja = i.recipient === "車公司" ? busCompanyBodyJa(i) : guideBodyJa(i);
  const zh = i.recipient === "車公司" ? busCompanyBody(i) : guideBodyZh(i);
  // 署名只放在日文段末尾（那是實際寄給對方的主體）。
  // 中文段是給我方窗口核對用的，不需要再重複一次系統署名，收個尾就好（Ina 2026-08-15）。
  return `${ja}\n\n※ 本メールは KKday 専属ツアーシステムより自動送信しております。\n\n${LANG_SEP}\n\n${zh}\n\n謝謝您。\n\n— 本信由 KKday 專屬團系統自動寄送`;
}

/** 中文版（原本的內容；署名已移到 mailBody 統一處理）。 */
function guideBodyZh(i: GuideMailInput): string {
  const lines = [
    // 直呼全名對導遊不禮貌（Ina 2026-08-15）→ 加職稱。名字帶括號讀音時只取前段。
    `${displayGuide(i.guideName)} 導遊 您好，`,
    ``,
    i.pass === 2
      ? `司機資訊已確認，附上更新版名單。請以本封為準，先前寄出的那份請勿再使用。`
      : `附上明日帶團的旅客名單，請確認：`,
    ``,
    `　出發日期：${i.departureDate}`,
    `　商品編號：${i.productNo}`,
    `　行程：${i.productName}`,
    ...(planNames(i.bus).length ? [`　方案：${planNames(i.bus).join("／")}`] : []),
    ...(mailSpecs(i.bus).length ? [`　當天路線：${mailSpecs(i.bus).join("／")}`] : []),
    `　團號：${i.bus.tourCode || "－"}${i.bus.carLetter ? `　車別：${i.bus.carLetter} 車` : ""}`,
    `　旅客人數：${i.bus.total} 位`,
  ];
  // 司機資訊分三種情況，**不用車的行程一個字都不要提車**（Ina 2026-08-15）：
  // 30651 嵐山走鐵道＋遊船，本來就沒有巴士，跟導遊說「車公司回報後會再寄更新版」只會讓人困惑。
  if (i.usesVehicle === false) {
    // 什麼都不寫。這個行程沒有車，沒有待補的資訊，也不會有更新版名單。
  } else if (i.hasVehicle) {
    lines.push(`　車輛與司機：${i.vehicle ? vehicleLine("zh", i.vehicle) : "詳見名單上方"}`);
  } else {
    // 原本每行開頭是「※」加全形空格縮排，在郵件軟體裡對不齊也看不出層次（Ina 2026-08-15）→
    // 改成一般段落，不用符號。
    lines.push(
      ``,
      `車輛與司機資訊車公司尚未回報，名單上標示「司機資訊稍後提供」。`,
      `車公司回報後我們會再寄一次更新版名單；若到傍晚仍未回報，會由 KKday 窗口直接以 LINE／WeChat 通知您。`,
    );
  }
  lines.push(``, `名單如有疑問，請直接回覆本信或聯絡 KKday 窗口。`);
  return lines.join("\n");
}
