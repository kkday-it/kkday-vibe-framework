"""
旅行業責任險自動投保 - 核心流程
完整移植自原先的 insurance_gui_date_picker.py

⚠️ 暫留 Selenium 降級路徑(ctx.browser.get_driver,DeprecationWarning):
317 行外站 RPA 盲改 Playwright 無法驗證(b2b.518fb.com 要真跑才知道),
待有真實執行機會時再改寫成 ctx.browser.new_page() — 屆時順便把
sleep 改 auto-wait、alert 改 dialog handler。
"""
import time
import os
import re
from datetime import datetime
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, StaleElementReferenceException

def flow(ctx, eff_date, exp_date, excel_file_path, tra_no, represent_mem, total_mem):
    # 取得機密資料
    account = ctx.secrets.get("ACCOUNT")
    password = ctx.secrets.get("PASSWORD")
    company = ctx.secrets.get("COMPANY", "eApply1-111")
    birthday = ctx.secrets.get("BIRTHDAY")
    captcha = ctx.secrets.get("CAPTCHA", "1234")
    case_owner = ctx.secrets.get("CASE_OWNER")
    
    # 定義下載與輸出目錄 (改為使用系統暫存，避免 EKS 容器衝突)
    output_dir = "/tmp/insurance_output"
    downloads_dir = "/tmp/insurance_downloads"
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(downloads_dir, exist_ok=True)
    
    ctx.logger.info("="*60)
    ctx.logger.info("🚀 開始投保作業")
    ctx.logger.info("="*60)
    ctx.logger.info(f"📅 起保日期：{eff_date} 00:00")
    ctx.logger.info(f"📅 迄保日期：{exp_date} 00:00")
    ctx.logger.info(f"📁 名單路徑：{excel_file_path}")
    ctx.logger.info(f"👤 代表：{represent_mem}")
    ctx.logger.info(f"👥 人數：{total_mem}")
    ctx.logger.info(f"🔢 圈號：{tra_no}")
    
    # 透過 platform_sdk 取得瀏覽器 (這裡假設 platform_sdk 會幫忙設定好 downloads_dir)
    driver = ctx.browser.get_driver(download_dir=downloads_dir)
    wait = WebDriverWait(driver, 30)
    
    try:
        ctx.logger.info("1️⃣ 開啟登入頁...")
        driver.get("https://b2b.518fb.com/ec/b2b_index.jsp")
        time.sleep(2)
        driver.refresh()
        time.sleep(3)
        
        ctx.logger.info("2️⃣ 填寫登入資訊...")
        wait.until(EC.presence_of_element_located((By.NAME, "unionNum")))
        driver.find_element(By.NAME, "unionNum").send_keys(company)
        driver.find_element(By.NAME, "employNum").send_keys(account)
        driver.find_element(By.NAME, "xpassword").send_keys(password)
        driver.find_element(By.NAME, "kaptcha").send_keys(captcha)
        driver.find_element(By.ID, "widgetu888").click()
        time.sleep(4)
        
        ctx.logger.info("3️⃣ 處理生日彈窗...")
        try:
            inputs = driver.find_elements(By.CSS_SELECTOR, 'input[type="text"]')
            inputs[-1].clear()
            inputs[-1].send_keys(birthday)
            driver.find_element(By.XPATH, '//button[contains(text(),"確認登入")]').click()
        except Exception:
            pass
        time.sleep(3)
        
        # 登入後清掉 Alert
        try:
            alert = driver.switch_to.alert
            ctx.logger.info("⚠️ 登入後偵測到 alert，自動關閉")
            alert.accept()
            time.sleep(1)
        except Exception:
            pass
            
        ctx.logger.info("4️⃣ 點選旅行業責任險...")
        try:
            alert = driver.switch_to.alert
            alert_text = alert.text
            ctx.logger.info(f"⚠️ 偵測到系統公告，自動關閉：{alert_text[:30]}...")
            alert.accept()
            time.sleep(1)
        except Exception:
            pass
            
        main_window = driver.current_window_handle
        driver.switch_to.frame("lower")
        driver.find_element(By.XPATH, '//img[contains(@src,"t100.jpg")]').click()
        driver.switch_to.default_content()
        time.sleep(2)
        
        wait.until(lambda d: len(d.window_handles) > 1)
        
        ctx.logger.info("5️⃣ 選擇費率...")
        try:
            wait_short = WebDriverWait(driver, 10)
            wait_short.until(lambda d: len(d.window_handles) >= 3)
        except Exception:
            pass
        time.sleep(1)
        
        all_windows = driver.window_handles
        non_main = [w for w in all_windows if w != main_window]
        
        rate_window = None
        form_window = None
        for w in non_main:
            driver.switch_to.window(w)
            try:
                driver.find_element(By.NAME, "caseOwner")
                form_window = w
            except Exception:
                rate_window = w
        
        if form_window is None and rate_window is not None:
            form_window = rate_window
            rate_window = None
            
        if rate_window:
            driver.switch_to.window(rate_window)
            try:
                links = driver.find_elements(By.TAG_NAME, "a")
                for link in links:
                    txt = link.text.strip()
                    if txt and "excel" not in txt.lower() and "下載" not in txt:
                        ctx.logger.info(f"✅ 點選費率：{txt}")
                        link.click()
                        break
            except Exception as e:
                ctx.logger.error(f"⚠️ 費率視窗操作失敗：{e}")
            time.sleep(2)
            
            remaining = driver.window_handles
            if form_window not in remaining:
                candidates = [w for w in remaining if w != main_window]
                form_window = candidates[0] if candidates else main_window
                
        try:
            driver.switch_to.window(form_window)
            ctx.logger.info("✅ 已切換到表單視窗")
        except Exception as e:
            ctx.logger.warning(f"🔄 重新定位表單視窗...")
            remaining = driver.window_handles
            candidates = [w for w in remaining if w != main_window]
            form_window = candidates[0] if candidates else remaining[0]
            driver.switch_to.window(form_window)
            
        time.sleep(2)
        ctx.logger.info("6️⃣ 填寫投保表單...")
        wait.until(EC.presence_of_element_located((By.NAME, "caseOwner")))
        wait.until(EC.element_to_be_clickable((By.NAME, "caseOwner")))
        time.sleep(1)
        
        def safe_fill(name, value):
            for _ in range(3):
                try:
                    el = wait.until(EC.element_to_be_clickable((By.NAME, name)))
                    el.clear()
                    el.send_keys(value)
                    return
                except StaleElementReferenceException:
                    time.sleep(0.5)
            raise Exception(f"無法填寫欄位：{name}")

        safe_fill("caseOwner", case_owner)
        safe_fill("traNo", tra_no)
        safe_fill("representMem", represent_mem)
        safe_fill("totalMem", str(total_mem))
        
        for _ in range(3):
            try:
                Select(driver.find_element(By.NAME, "countryArea")).select_by_visible_text("台灣地區")
                break
            except StaleElementReferenceException:
                time.sleep(0.5)
        time.sleep(1)
        for _ in range(3):
            try:
                Select(driver.find_element(By.NAME, "travelArea")).select_by_visible_text("台灣本島")
                break
            except StaleElementReferenceException:
                time.sleep(0.5)

        safe_fill("effDate", eff_date)
        safe_fill("expDate", exp_date)
        
        for cb in driver.find_elements(By.NAME, "transportAry"):
            try:
                val = cb.get_attribute("value")
                if val in ["4", "6"]:
                    if not cb.is_selected():
                        cb.click()
                else:
                    if cb.is_selected():
                        cb.click()
            except StaleElementReferenceException:
                pass
                
        driver.execute_script("""
            var sel1 = document.querySelector('select[name="insAmount1"]');
            for(var i=0; i<sel1.options.length; i++){
                if(sel1.options[i].text.includes('250')){
                    sel1.selectedIndex = i; break;
                }
            }
            var sel2 = document.querySelector('select[name="insAmount2"]');
            for(var i=0; i<sel2.options.length; i++){
                if(sel2.options[i].text.includes('20')){
                    sel2.selectedIndex = i; break;
                }
            }
        """)
        
        driver.find_element(By.NAME, "namelistFile1").send_keys(excel_file_path)
        time.sleep(2)
        
        ctx.logger.info("7️⃣ 送出表單...")
        next_button = wait.until(EC.element_to_be_clickable((By.XPATH, '//input[@value="下一步"]')))
        driver.execute_script("arguments[0].scrollIntoView(true);", next_button)
        time.sleep(1)
        next_button.click()
        time.sleep(3)
        
        next_button2 = wait.until(EC.element_to_be_clickable((By.XPATH, '//input[@value="下一步(進行儲存)"]')))
        next_button2.click()
        time.sleep(3)
        
        ctx.logger.info("8️⃣ 擷取投保資訊...")
        page_text = driver.find_element(By.TAG_NAME, "body").text
        
        transaction_match = re.search(r'交易序號[：:]\s*(\S+)', page_text)
        review_match = re.search(r'覆核號碼[：:]\s*(\S+)', page_text)
        fee_match = re.search(r'保險費[：:]\s*([0-9,]+)', page_text)
        
        transaction_no = transaction_match.group(1).strip() if transaction_match else "未知"
        review_no = review_match.group(1).strip() if review_match else "未知"
        insurance_fee = fee_match.group(1).strip() if fee_match else "未知"
        
        ctx.logger.info(f"📝 交易序號：{transaction_no}")
        ctx.logger.info(f"📝 覆核號碼：{review_no}")
        ctx.logger.info(f"💰 保險費：{insurance_fee}元")
        
        ctx.logger.info("9️⃣ 創建記錄檔...")
        today = datetime.now()
        today_str = f"{today.year - 1911}/{today.month:02d}/{today.day:02d}"
        
        content = f"""=====================================
   旅行業責任險投保記錄
=====================================
投保日期：{today_str}
圈號：{tra_no}
代表人：{represent_mem}
人數：{total_mem}人
旅遊期間：起保 {eff_date} 00:00 / 迄保 {exp_date} 00:00
-------------------------------------
交易序號：{transaction_no}
覆核號碼：{review_no}
保險費：{insurance_fee}元
-------------------------------------
記錄時間：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""
        txt_path = os.path.join(output_dir, f"{review_no}.txt")
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(content)
        ctx.logger.info("✅ 記錄檔已保存")
        
        # 🔟 下載保單 (簡化版下載邏輯)
        pdf_path = ""
        if review_no and review_no != "未知":
            ctx.logger.info("🔟 自動下載保單...")
            try:
                print_button = wait.until(EC.element_to_be_clickable((By.XPATH, '//input[@value="列印保險證明書"]')))
                print_button.click()
                time.sleep(3)
                
                # 切換到列印視窗並點擊列印 (交由瀏覽器自動儲存到 downloads_dir)
                new_windows = [w for w in driver.window_handles if w not in all_windows]
                if new_windows:
                    driver.switch_to.window(new_windows[0])
                    print_confirm = wait.until(EC.element_to_be_clickable((By.XPATH, '//input[@value="列印"]')))
                    print_confirm.click()
                    time.sleep(5)
                    
                    # 尋找下載的 PDF
                    files = os.listdir(downloads_dir)
                    pdf_files = [f for f in files if f.endswith('.pdf')]
                    if pdf_files:
                        latest_pdf = max([os.path.join(downloads_dir, f) for f in pdf_files], key=os.path.getmtime)
                        pdf_path = os.path.join(output_dir, f"{review_no}.pdf")
                        import shutil
                        shutil.move(latest_pdf, pdf_path)
                        ctx.logger.info(f"✅ 保單已保存：{pdf_path}")
            except Exception as e:
                ctx.logger.error(f"下載保單失敗：{e}")
                
        ctx.logger.info("✅ 投保完成!")
        
        return {
            "status": "success",
            "transaction_no": transaction_no,
            "review_no": review_no,
            "insurance_fee": insurance_fee,
            "txt_path": txt_path,
            "pdf_path": pdf_path
        }
        
    except Exception as e:
        ctx.logger.error(f"❌ 錯誤：{str(e)}")
        ctx.notify.slack(f"❌ 旅行業保險自動化失敗 (圈號: {tra_no}): {str(e)}")
        return {
            "status": "error",
            "error_msg": str(e)
        }
    finally:
        ctx.browser.close(driver)
