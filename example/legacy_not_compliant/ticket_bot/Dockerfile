FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

RUN useradd -m -r appuser

WORKDIR /app

COPY platform_sdk/py/ /app/platform_sdk/py/
COPY example/ticket_bot/requirements.txt /app/example/ticket_bot/

WORKDIR /app/example/ticket_bot

RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium \
    && playwright install-deps

COPY example/ticket_bot/ /app/example/ticket_bot/

USER appuser
EXPOSE 8080

CMD ["flask", "run", "--host=0.0.0.0", "--port=8080"]
