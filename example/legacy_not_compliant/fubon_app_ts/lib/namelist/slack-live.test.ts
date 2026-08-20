import { test } from "node:test";
import assert from "node:assert/strict";
import { slackLive } from "./slack-out.ts";

test("什麼都沒設 → 不送（預設安靜，這是重點）", () => {
  assert.equal(slackLive({} as NodeJS.ProcessEnv), false);
});

test("只有 SEND_FOR_REAL=1 也不送 —— 那面旗子管的是別的事", () => {
  assert.equal(slackLive({ SEND_FOR_REAL: "1" } as NodeJS.ProcessEnv), false);
});

test("要送必須明確 SLACK_LIVE=1", () => {
  assert.equal(slackLive({ SLACK_LIVE: "1" } as NodeJS.ProcessEnv), true);
});

test("SLACK_DRY_RUN=1 是一票否決，就算 SLACK_LIVE=1 也不送", () => {
  assert.equal(slackLive({ SLACK_LIVE: "1", SLACK_DRY_RUN: "1" } as NodeJS.ProcessEnv), false);
});

test("SLACK_LIVE 只認 '1'，true／yes 都不算 —— 免得手滑打錯就對外送", () => {
  for (const v of ["true", "yes", "on", "TRUE", " 1 x"]) {
    assert.equal(slackLive({ SLACK_LIVE: v } as NodeJS.ProcessEnv), false, v);
  }
});
