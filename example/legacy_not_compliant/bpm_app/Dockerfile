# 使用官方的 Python image 作為 Base Image
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8501

RUN useradd -m -r appuser

WORKDIR /app

# 複製 platform_sdk/py
COPY platform_sdk/py/ /app/platform_sdk/py/

# bpm_app 也需要 playwright, streamlit
# 假設我們在 bpm_app 建立一個基本的 requirements.txt
COPY example/bpm_app/requirements.txt /app/example/bpm_app/
WORKDIR /app/example/bpm_app

RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium \
    && playwright install-deps

COPY example/bpm_app/ /app/example/bpm_app/

USER appuser
EXPOSE 8501

CMD ["streamlit", "run", "src/main.py", "--server.address", "0.0.0.0", "--server.port", "8501"]
