"""
BPM 送單核心流程 - 移植自 bpm_submit.py
瀏覽器一律經 ctx.browser(受管 Playwright headless),不直接 import playwright。
"""
import os
import json as _json
import uuid
from datetime import date

def flow(ctx, order_no, company, currency, cert_company, amount, dept):
    # 從 ctx 取得機密字串 (JSON 格式)
    session_json_str = ctx.secrets.get("ODOO_SESSION_JSON")
    
    if not session_json_str:
        raise Exception("找不到 ODOO_SESSION_JSON 變數。請提供有效的 Session 字串。")
        
    session_data = _json.loads(session_json_str)

    today = date.today().strftime("%Y/%m/%d")
    year = str(date.today().year)
    month = f"{date.today().month:02d}"

    # 部門固定 ID（顧客關係管理部）
    DIVISION_ID = "GO01000000"
    DEPT_ID = "GO01010000"

    ctx.logger.info("="*60)
    ctx.logger.info("🚀 開始 BPM 送單")
    ctx.logger.info(f"訂單：{order_no} | 公司：{company} | 金額：{amount} {currency}")
    ctx.logger.info(f"憑證公司：{cert_company} | 部門：{dept}")

    page = ctx.browser.new_page(storage_state=session_data, no_viewport=True)

    try:
        ctx.logger.info("1️⃣ 登入 Odoo...")
        page.goto("https://odoo.eip.kkday.net/odoo/home")
        page.wait_for_selector("#bpm", timeout=60000)
        page.wait_for_timeout(500)
            
        ctx.logger.info("✅ session 已載入")
            
        page.click("#bpm")
        page.wait_for_timeout(5000)

        ctx.logger.info("2️⃣ 啟動流程...")
        page.click("a[href='#createPro']")
        page.wait_for_timeout(1000)
        page.click("#bar_all")
        page.wait_for_timeout(1000)
        page.click("#PMP000000001004")
        page.wait_for_timeout(1000)
        page.evaluate("selectProImmed('PRO00121671783193897','false','false')")
        page.wait_for_timeout(1000)

        page.fill("#quicklyKeyword", order_no)
        page.wait_for_timeout(500)
        page.click("input[value='啟動流程']")
        page.wait_for_timeout(8000)

        page.wait_for_selector("iframe[name='artifact']", timeout=15000)
        iframe = page.frame(name="artifact")
        if not iframe:
            raise Exception("找不到 artifact iframe")

        page.wait_for_timeout(3000)
        ctx.logger.info("3️⃣ 填寫基本欄位...")

        iframe.click("input[name='groupIsReqGroup'][value='IsReqNo']")
        page.wait_for_timeout(500)
        iframe.select_option("select[name='Payment']", label="銀行匯款 / Bank Remittance")
        page.wait_for_timeout(2000)
        iframe.evaluate("document.querySelector('#ITEM251').click()")
        page.wait_for_timeout(500)
        iframe.select_option("select[name='OurCompanyName']", label=company)
        page.wait_for_timeout(3000)
        iframe.evaluate(f"document.querySelector(\"select[name='MoneyType']\").value='{currency}'")
        page.wait_for_timeout(500)
        iframe.click("input[name='groupHasCertGroup'][value='HasCertYes']")
        page.wait_for_timeout(1000)

        ctx.logger.info("4️⃣ 填寫憑證資料...")
        iframe.fill("input[name='CertCompany']", cert_company)
        page.wait_for_timeout(500)
        iframe.fill("input[name='TaxID']", "0000")
        page.wait_for_timeout(500)
        iframe.select_option("select[name='CertType']", label="其他憑證(Others)")
        page.wait_for_timeout(500)
        iframe.fill("input[name='CertDate']", today)
        page.wait_for_timeout(500)
        iframe.fill("input[name='CertAmt']", amount)
        page.wait_for_timeout(500)
        iframe.click("input[name='CrtCert']")
        page.wait_for_timeout(4000)

        ctx.logger.info("5️⃣ 設定採購項目與 CertYes...")
        iframe.evaluate(f"(() => {{ const dept = '{dept}'; Array.from(document.DynamicForm.elements).forEach(el => {{ if (el.name === 'CertYesDEP') el.value = dept; }}); }})()")
            
        fill_diag = iframe.evaluate(f"""
        (() => {{
          const f = document.DynamicForm;
          const set = (sel, val) => {{ const el = document.querySelector(sel); if (el) el.value = val; }};
          set("select[name='CertYesExpType']",  '客訴 - Customer Complain Fee');
          set("select[name='CertYesPayYear']",  '{year}');
          set("select[name='CertYesPayMonth']", '{month}');
          set("input[name='CertYesExpDesc']",   '{order_no}_匯退');
          set("input[name='CertYesAmt']",       '{amount}');
          set("input[name='CertYesTotalAmt']",  '{amount}');
          return "done";
        }})()
        """)

        # 攔截 RoleSearch.do (省略部分太長的 debug print，改為 logger)
        role_search_bodies = []
        def _capture_rs(resp):
            if "RoleSearch.do" in resp.url:
                try: role_search_bodies.append(resp.text())
                except: pass
        page.on("response", _capture_rs)

        ctx.logger.info("6️⃣ 操作組織樹...")
        with page.expect_response(lambda r: "runScriptServlet" in r.url, timeout=15000):
            iframe.evaluate("document.getElementById('ITEM169').click()")
        page.wait_for_selector(".modal.in", timeout=8000)
            
        short_name = dept.split('(')[0]
        search_keyword = short_name[:4]

        page.evaluate("(() => { const tabs = Array.from(document.querySelectorAll('.modal.in [data-toggle=\"tab\"]')); const t = tabs.find(a => a.textContent.trim() === '搜尋'); if (t) t.click(); })()")
        page.wait_for_timeout(500)

        page.evaluate(f"(() => {{ const input = document.getElementById('flowringRoleTreeModalKeyword'); if (input) {{ input.value = '{search_keyword}'; flowringRoleTreeModalSearchCheck(); }} }})()")
        page.wait_for_timeout(2500)

        page.evaluate(f"(() => {{ const buttons = Array.from(document.querySelectorAll('.flowringRoleTreeModalResultOrgTreeLink')); const match = buttons.find(b => b.textContent.includes('{short_name}')); if (match) match.click(); }})()")
        page.wait_for_timeout(800)

        try:
            with page.expect_response(lambda r: "runScriptServlet" in r.url, timeout=6000) as confirm_resp:
                page.evaluate("(() => { const modal = document.querySelector('.modal.in'); const btn = modal && (modal.querySelector('.modal-footer .btn-primary') || Array.from(modal.querySelectorAll('button')).find(b => b.textContent.includes('確認'))); if (btn) btn.click(); })()")
        except Exception as e:
            pass
            
        page.wait_for_timeout(3000)
            
        # 設定部門 ID
        iframe.evaluate(f"(() => {{ Array.from(document.DynamicForm.elements).forEach(el => {{ if (el.name === 'CertYesDivisionID') el.value = '{DIVISION_ID}'; if (el.name === 'CertYesDepID') el.value = '{DEPT_ID}'; }}); }})()")

        ctx.logger.info("7️⃣ 送出新增項目...")
        with page.expect_response(lambda r: "runScriptServlet" in r.url, timeout=15000):
            iframe.locator('#ITEM180').click()
        page.wait_for_timeout(3000)

        ctx.logger.info("8️⃣ 驗證表格...")
        row_55  = iframe.evaluate("$('#ITEM55Table').dataTable().fnGetData().length")
        row_132 = iframe.evaluate("$('#ITEM132Table').dataTable().fnGetData().length")
            
        if (isinstance(row_55, int) and row_55 > 0) or (isinstance(row_132, int) and row_132 > 0):
            ctx.logger.info("✅ 表格有資料，點擊最終送出...")
            iframe.click("input[type='button'][value='送出'], input[value='Submit']")
            page.wait_for_timeout(5000)
            ctx.logger.info("✅ BPM 送出完成！")
        else:
            raise Exception("送出前驗證失敗：表格中無資料。")

        return {"status": "success"}

    except Exception as e:
        ctx.logger.error(f"❌ 錯誤: {str(e)}")
        ctx.notify.slack(f"❌ BPM 送單失敗 ({order_no}): {str(e)}")
        return {"status": "error", "error_msg": str(e)}
    finally:
        ctx.browser.close()
