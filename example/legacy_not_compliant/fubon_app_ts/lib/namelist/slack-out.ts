/**
 * 演練時把「本來會貼到群組的每一則 Slack」原文存下來（Ina 2026-08-17）。
 *
 * 為什麼需要：演練的重點是**看到真人會看到的那則訊息長什麼樣**。
 * 但各支腳本在未真送時的印法各自為政——preflight 只印前三行就 `…` 掉，
 * 於是要核對訊息內容的人反而看不到內容，只能聽我轉述，而轉述一定會走樣。
 *
 * 設了 `SLACK_DUMP_DIR` 就把每一則寫成一個檔（001-xxx.txt、002-xxx.txt…），
 * 檔案內容就是**要送出去的那串字元本身**，一個字都不加。
 *
 * ⚠️ 這些檔可能含導遊姓名與電話。演練完自己刪，不要留在機器上、不要上傳 artifact。
 */
import { appendFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brief, blocksOf, type SlackBrief } from "./slack-format.ts";

const DIR = (process.env.SLACK_DUMP_DIR ?? "").trim();

/** 檔名只留安全字元，順序前綴讓人一眼看出這天發了幾則、順序為何。 */
function nextPath(what: string): string {
  mkdirSync(DIR, { recursive: true });
  const n = String(readdirSync(DIR).filter((f) => f.endsWith(".txt") && f !== "index.txt").length + 1).padStart(3, "0");
  const slug = what.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "slack";
  return join(DIR, `${n}-${slug}.txt`);
}

/**
 * 記下這則訊息的原文。回傳有沒有記（沒設 SLACK_DUMP_DIR 就是 false）。
 * **不負責送出**——送不送是呼叫端各自的閘門，這裡只是留一份逐字稿。
 */
export function dumpSlack(msg: string, what: string, blocks?: object[]): boolean {
  if (!DIR) return false;
  const p = nextPath(what);
  /**
   * 有 blocks 就一起存一條 **Block Kit Builder 連結**——貼進瀏覽器看到的
   * 就是真人會看到的長相。本機驗證不必真的發一則到頻道去確認排版
   *（Ina 2026-08-18：「這4封是發生什麼事？不要一直寄，很擾民」）。
   */
  const preview = blocks?.length
    ? `\n\n──────\n預覽（貼進瀏覽器）：https://app.slack.com/block-kit-builder/#${encodeURIComponent(JSON.stringify({ blocks }))}\n`
    : "";
  writeFileSync(p, msg + preview, "utf8");
  // 索引檔讓人知道總共幾則、各是什麼，不用一個個開
  appendFileSync(join(DIR, "index.txt"), `${p}\t${what}\n`, "utf8");
  console.log(`\n📝 訊息原文已存：${p}`);
  return true;
}

/**
 * 這一則到底送不送。**預設是不送**——要送必須明確設 `SLACK_LIVE=1`。
 *
 * 為什麼是這個方向（Ina 2026-08-16「可以別再發生這種事嗎，我也刪不掉」）：
 * 前一版是「設了 SLACK_DRY_RUN=1 才安靜」，忘記設就會吵到人，而 webhook 送出去
 * **刪不掉**。當天在雲端跑三次驗證，就真的深夜 tag 了 Klo & Winnie 三次。
 *
 * 把預設倒過來之後，忘記設的後果從「吵到真人、收不回來」變成「沒人收到通知」——
 * 後者看得見（訊息沒出現）、也救得回來（補跑一次）。
 * 危險的那一邊要用力氣才做得到，安全的那一邊不用。
 *
 * `SLACK_DRY_RUN=1` 仍然有效，當作臨時的一票否決（兩個都設時它贏）。
 */
export function slackLive(env = process.env): boolean {
  if (String(env.SLACK_DRY_RUN ?? "").trim() === "1") return false;
  return String(env.SLACK_LIVE ?? "").trim() === "1";
}

/** @deprecated 用 slackLive()。留著只為了讓舊呼叫端不會靜默改變行為。 */
export function slackDryRun(env = process.env): boolean {
  return !slackLive(env);
}

/**
 * 這則要送去哪——**只印指紋，不印 webhook 本身**（webhook 等同發文權限）。
 * 用途：8/17 Ina 另開測試群之後，光看 log 分不出「這則進的是正式群還是測試群」。
 * 尾碼六碼足以分辨兩支不同的 webhook，又不足以拿去發文。
 */
export function webhookHint(url: string): string {
  const u = String(url ?? "").trim();
  return u ? `…${u.slice(-6)}` : "（沒設）";
}

/**
 * 送一則到 Slack。**所有對外的 Slack 都要走這裡**。
 *
 * 為什麼非收斂不可（Ina 2026-08-17 要另開測試群時清出來的）：
 * 原本五個地方各自 `fetch(webhook)`，各自判斷該不該送。
 * 8/16 深夜真的 tag 了 Klo & Winnie，就是因為其中一支沒有閘門而我以為都有。
 * 而 run-job 那支還會在 JP webhook 沒設時**退回用富邦那支**——
 * 那會把專屬團的失敗通知送進富邦的頻道，收到的人完全看不懂。已移除那個退路。
 *
 * 回傳有沒有真的送出去。
 */
export async function postSlack(
  msg: string, what: string, env = process.env, blocks?: object[],
): Promise<boolean> {
  dumpSlack(msg, what, blocks);
  const hook = String(env.SLACK_WEBHOOK_JP_TOUR ?? "").trim();
  if (!slackLive()) {
    console.log(`\n📣 **沒有送出**（${what}；要對外通知請設 SLACK_LIVE=1）：\n${msg}`);
    return false;
  }
  if (String(env.SEND_FOR_REAL ?? "").trim() !== "1") {
    console.log(`\n📣 **沒有送出**（${what}；SEND_FOR_REAL 不是 1）：\n${msg}`);
    return false;
  }
  if (!hook) {
    console.log(`\n📣 **沒有送出**（${what}；沒設 SLACK_WEBHOOK_JP_TOUR）：\n${msg}`);
    return false;
  }
  /**
   * 有 blocks 就送 blocks（Ina 2026-08-18 選的排版）。`text` 一定要一起送——
   * 手機通知列、搜尋結果、舊版 client 看到的都是它，只送 blocks 會變成空白通知。
   */
  const send = (body: object) => fetch(hook, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let res = await send(blocks?.length ? { text: msg, blocks } : { text: msg });
  /**
   * 🔴 **blocks 被打回來就退回純文字再送一次**。
   *
   * Block Kit 有一堆硬限制（50 個 block、按鈕要真網址、文字 3000 字…），
   * blocksOf 已經先擋過，但只要有一條沒想到，Slack 回的是 400 invalid_blocks，
   * 結果是**整則消失**——而「沒收到訊息」跟「今天沒事」長得一模一樣，
   * 沒有人會發現。排版壞掉可以忍，訊息不見不行。
   */
  if (!res.ok && blocks?.length) {
    const why = (await res.text()).slice(0, 120);
    console.log(`\n⚠️ Block Kit 版被 Slack 打回來（${what}）：HTTP ${res.status} ${why} → 改送純文字版`);
    res = await send({ text: msg });
  }
  if (!res.ok) {
    // 送失敗要吵，不能安靜吞掉——沒人收到通知跟「今天沒事」長得一模一樣
    console.log(`\n🚨 Slack 送不出去（${what}）：HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    return false;
  }
  console.log(`\n📣 已通知 Slack（${what}）→ webhook ${webhookHint(hook)}`);
  markNotified();
  return true;
}

/**
 * 告訴外層的 run-job：「這件事我已經自己跟人講過了」。
 *
 * 沒有這個記號的話，失敗的那次會發**兩則**——一則是這裡送出的完整報告，
 * 一則是 run-job 的通用失敗通知（純文字、沒有 Block、也沒有任何新資訊）。
 * 2026-08-19 17:02 的 SCM 回填就是這樣連發兩則（Ina 問「為何發了兩次」）。
 */
export function markNotified(env = process.env): void {
  const flag = String(env.JP_NOTICE_FLAG ?? "").trim();
  if (!flag) return;
  try { writeFileSync(flag, ""); } catch { /* 記號寫不成只是會多一則通知，不值得讓整批失敗 */ }
}

/**
 * 一則摘要 ＋ 明細放在**討論串裡**（Ina 2026-08-17：「這樣 slack post 會太長」）。
 *
 * 為什麼要分兩層：九台車、每台好幾張訂單，全部攤在頻道上會洗版，
 * 而真正需要天天看的只有一行「幾張成功、幾張失敗」。明細是出事時才點開的東西。
 *
 * Slack 的限制決定了做法：
 *  - **incoming webhook 開不了討論串**——它回的是字串 `ok`，沒有訊息 ts，
 *    沒有 ts 就沒辦法回在某一則底下。這是 Slack 的設計，不是設定問題。
 *  - 要真的有討論串，得用 bot token 的 `chat.postMessage`（回傳 ts），
 *    再帶 `thread_ts` 回一則。需要 `SLACK_BOT_TOKEN` ＋ 頻道 ID（`SLACK_CHANNEL_JP_TOUR`），
 *    而且那個 bot 要先被邀進該頻道。
 *
 * 所以沒有 bot token 時**不會偷偷把明細貼進頻道**（那正是要避免的事）：
 * 只送摘要，明細留在執行紀錄裡。呼叫端該把「重要到不能只留 log」的東西放進摘要。
 */
export async function postSlackThread(
  summary: string, details: string[], what: string, env = process.env, blocks?: object[],
): Promise<boolean> {
  const token = String(env.SLACK_BOT_TOKEN ?? "").trim();
  const channel = String(env.SLACK_CHANNEL_JP_TOUR ?? "").trim();
  const body = details.filter((d) => d.trim());
  dumpSlack([summary, ...body].join("\n\n──────\n"), what);

  if (!token || !channel) {
    if (body.length) console.log(`\n🧵 沒有 SLACK_BOT_TOKEN／SLACK_CHANNEL_JP_TOUR → 明細不進頻道，只留在這份紀錄：\n${body.join("\n")}`);
    return postSlack(summary, what, env, blocks);
  }
  if (!slackLive() || String(env.SEND_FOR_REAL ?? "").trim() !== "1") {
    console.log(`\n📣 **沒有送出**（${what}）：\n${summary}\n${body.join("\n")}`);
    return false;
  }

  const call = async (payload: object) =>
    fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }).then((r) => r.json() as Promise<{ ok: boolean; ts?: string; error?: string }>);

  let head = await call(blocks?.length ? { channel, text: summary, blocks } : { channel, text: summary });
  // blocks 被打回來就退回純文字再試一次（同 postSlack）——訊息不見比排版醜嚴重得多
  if ((!head.ok || !head.ts) && blocks?.length) {
    console.log(`\n⚠️ Block Kit 版被打回來（${head.error}）→ 改送純文字版`);
    head = await call({ channel, text: summary });
  }
  if (!head.ok || !head.ts) {
    console.log(`\n🚨 Slack 送不出去（${what}）：${head.error} → 改用 webhook 送摘要`);
    return postSlack(summary, what, env, blocks);
  }
  // 明細一段一則回在串裡。某一則失敗只影響那一段，摘要已經在頻道上了
  for (const d of body) {
    const r = await call({ channel, text: d, thread_ts: head.ts });
    if (!r.ok) console.log(`\n⚠️ 討論串回覆失敗（${r.error}）：\n${d}`);
  }
  console.log(`\n📣 已通知 Slack（${what}）→ 頻道 ${channel}，明細 ${body.length} 則在討論串裡`);
  return true;
}


/**
 * 送一則排好版的訊息：**Block Kit 為主、純文字為輔**。
 *
 * 兩份內容都由同一個 `SlackBrief` 產出，所以不可能長不一樣——
 * 純文字那份是通知列與搜尋結果看到的東西，不是備份用的第二套寫法。
 */
export async function postBrief(b: SlackBrief, what: string, env = process.env): Promise<boolean> {
  return postSlack(brief(b), what, env, blocksOf(b));
}
