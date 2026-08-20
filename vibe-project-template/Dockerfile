FROM python:3.10-slim

# 不以 root 執行
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# 先複製 requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製專案原始碼
COPY . .

# 確保權限
RUN chown -R appuser:appuser /app
USER appuser

# Health endpoint 的 port
EXPOSE 8080

CMD ["./run.sh", "web"]
