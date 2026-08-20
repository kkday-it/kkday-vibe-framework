# Builder Stage
FROM python:3.11-slim AS builder

WORKDIR /build
# 安裝構建依賴 (如果是 git 安裝需要 git)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels -r requirements.txt

# Runtime Stage
FROM python:3.11-slim

RUN groupadd -r appuser && useradd -r -g appuser appuser
WORKDIR /app

# 安裝編譯好的 wheels
COPY --from=builder /build/wheels /wheels
COPY --from=builder /build/requirements.txt .
RUN pip install --no-cache-dir /wheels/*

# 只複製必要的原始碼目錄 (搭配 .dockerignore 排除 tests 等)
COPY src/ /app/src/
COPY workflows/ /app/workflows/
COPY PROJECT.yaml /app/
COPY run.sh /app/

RUN chown -R appuser:appuser /app && chmod +x /app/run.sh
USER appuser

EXPOSE 8080
CMD ["./run.sh", "web"]
