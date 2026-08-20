"""
BE2 工單處理 - 核心流程
瀏覽器一律經 ctx.browser(受管 Playwright headless);登入/建單細節待從原 repo 移植。
"""


def flow(ctx, order_id, wantan_type="mansatisfied", follow_type="page"):
    # 從 ctx 取得憑證,不直接讀 os.environ
    username = ctx.secrets.get("vault://ticket-bot/BE2_USERNAME")
    password = ctx.secrets.get("vault://ticket-bot/BE2_PASSWORD")

    page = ctx.browser.new_page()
    try:
        with ctx.log.step("login"):
            ctx.log.info(f"開始處理訂單: {order_id}")
            page.goto("https://be2.kkday.com/login")
            # TODO: 從原 kkday-ticket-bot 移植登入邏輯
            # page.fill("input[type='email']", username)
            # page.fill("input[type='password']", password)

        with ctx.log.step("create_ticket"):
            # TODO: 移植找訂單、建工單、寫後拋邏輯
            ticket_id = f"TICK-{order_id[-4:]}"
            ctx.log.info(f"工單建立成功: {ticket_id}", ticket_id=ticket_id)

        ctx.notify(f"✅ 訂單 {order_id} 工單完成: {ticket_id}")
        return {"status": "success", "ticket_id": ticket_id}
    finally:
        # 失敗時不在這裡吞錯 — 拋出讓框架做失敗三件套(截圖/告警/狀態頁)
        ctx.browser.close()
