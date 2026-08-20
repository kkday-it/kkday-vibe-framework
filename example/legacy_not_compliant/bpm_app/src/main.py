"""
BPM App - Web UI
使用 Streamlit 讓使用者上傳 CSV，並將第一筆資料傳給底層的 workflow 執行。
"""
import streamlit as st
import csv
import io
# 在這個框架中，我們會透過 platform_sdk 呼叫 workflow
from platform_sdk import run_workflow

st.set_page_config(page_title="🧾 BPM 匯退自動化", page_icon="🧾")
st.title("🧾 BPM 匯退自動化送單系統")

st.markdown("### 📁 上傳匯退統計表 (CSV)")
uploaded_file = st.file_uploader("上傳 CSV 檔案", type=["csv"])

if st.button("🚀 開始送單", type="primary"):
    if not uploaded_file:
        st.error("請先上傳 CSV 檔案！")
    else:
        # 解析 CSV
        try:
            content = uploaded_file.getvalue().decode("utf-8-sig")
            f = io.StringIO(content)
            reader = csv.reader(f)
            next(reader)  # Header 1
            row = next(reader)  # 第一筆資料
            
            order_no     = row[2]
            company      = row[3]
            currency     = row[4]
            cert_company = row[5]
            amount       = row[6]
            dept         = row[8]
            
            st.info(f"解析成功：訂單 {order_no} | 金額 {amount} {currency} | 部門 {dept}")
        except Exception as e:
            st.error(f"CSV 解析失敗：{str(e)}")
            st.stop()

        # 呼叫底層自動化 Workflow
        with st.spinner("自動化執行中，將開啟無頭瀏覽器連線 Odoo，請稍候..."):
            result = run_workflow(
                workflow_id="submit_bpm",
                inputs={
                    "order_no": order_no,
                    "company": company,
                    "currency": currency,
                    "cert_company": cert_company,
                    "amount": amount,
                    "dept": dept
                }
            )
            
            if result.get("status") == "success":
                st.success("✅ 送單完成！")
            else:
                st.error(f"❌ 送單失敗：{result.get('error_msg')}")
