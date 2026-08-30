FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1

WORKDIR /app

RUN pip install --no-cache-dir uv==0.9.18

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY alembic.ini ./
COPY migrations ./migrations
COPY cooper ./cooper

# Cloud Run supplies PORT and requires the service to listen on all container interfaces.
CMD ["sh", "-c", "uv run --frozen --no-dev --no-sync alembic upgrade head && uv run --frozen --no-dev --no-sync uvicorn cooper.app:app --host 0.0.0.0 --port ${PORT:-8080}"]
