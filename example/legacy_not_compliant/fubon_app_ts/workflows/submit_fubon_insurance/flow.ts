import { Context } from 'platform_sdk_ts';
import * as path from 'path';

// 假設這裡有引入 lib 裡面的 domain logic (原 repo 裡有許多這類的工具)
// import { fetchNamelist } from '../../lib/dap-source';
// import { applyInsurance } from '../../lib/playwright/fubon';

export async function flow(ctx: Context, inputs: any = {}) {
  const company = ctx.secrets.get("FUBON_COMPANY");
  const user = ctx.secrets.get("FUBON_USER");
  const pass = ctx.secrets.get("FUBON_PASSWORD");
  const driveFolderId = ctx.secrets.get("FUBON_NAMELIST_DRIVE_FOLDER_ID");

  ctx.logger.info("=========================================");
  ctx.logger.info("🚀 啟動富邦自動投保流程 (TS Version)");
  
  if (!company || !user || !pass) {
    throw new Error("Missing Fubon credentials in secrets!");
  }

  try {
    // 1. 取得名單 (模擬)
    ctx.logger.info(`從 Google Drive [${driveFolderId}] 下載今日名單...`);
    // await fetchNamelist(driveFolderId);
    
    // 2. 登入與填表 (這裡示範如何無縫銜接原有的 playwright page 操作)
    ctx.logger.info("啟動無頭瀏覽器進行投保...");
    const page = await ctx.browser!.newPage();
    
    await page.goto("https://b2b.518fb.com/login");
    // await page.fill('#username', user);
    // await applyInsurance(page, namelist);
    
    ctx.logger.info("✅ 投保成功，準備發送 Slack 通知...");
    ctx.notify.slack("✅ [富邦旅平險] 今日投保已全數完成。");
    
    return { status: "success" };
    
  } catch (error: any) {
    ctx.logger.error(`投保失敗: ${error.message}`);
    ctx.notify.slack(`❌ [富邦旅平險] 投保失敗: ${error.message}`);
    throw error;
  }
}
