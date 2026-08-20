# 使用官方的 Python image 作為 Base Image
FROM python:3.12-slim

# 設定環境變數
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8501

# 建立非 root 使用者 (提升安全性)
RUN useradd -m -r appuser

WORKDIR /app

# 先複製並安裝 platform_sdk (因為專案相依於它)
COPY platform_sdk/py/ /app/platform_sdk/py/
COPY example/insurance_app/requirements.txt /app/example/insurance_app/

# 安裝相依套件 (包含 Playwright browsers)
WORKDIR /app/example/insurance_app
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium \
    && playwright install-deps

# 複製專案原始碼
COPY example/insurance_app/ /app/example/insurance_app/

# 切換到非 root 使用者
USER appuser

# Streamlit 預設 port 為 8501，明確綁定 0.0.0.0
EXPOSE 8501

CMD ["streamlit", "run", "src/main.py", "--server.address", "0.0.0.0", "--server.port", "8501"]
