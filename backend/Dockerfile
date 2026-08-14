# Image nhiều stage — MỘT Dockerfile, hai đích:
#
#   --target dev   : có phụ thuộc dev (pytest, ruff), cài -e, code mount từ host,
#                    uvicorn --reload. Dùng với docker-compose.yml.
#   --target prod  : không có phụ thuộc dev, code nằm TRONG image, nhiều worker,
#                    không mount gì. Dùng với docker-compose.prod.yml.
#
# Container chạy Python 3.12 đúng theo TS-01, dù máy dev chỉ có 3.10.
# Code phải chạy được trên CẢ HAI — xem pyproject.toml requires-python.

# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libxml2/libxslt cho lxml; libpq cho psycopg. Không cài compiler —
# dùng wheel dựng sẵn để image gọn và build nhanh.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 \
        libxslt1.1 \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/backend

# Chạy bằng user thường, không phải root (TS-08 mục VII).
# Tạo ở base để cả hai stage dùng chung đúng một uid.
RUN useradd --create-home --uid 10001 ailegal

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# ─────────────────────────────────────────────────────────────────────────────
# DEV — vòng lặp nhanh: sửa code trên host là container nạp lại ngay
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS dev

# Lớp phụ thuộc tách riêng để cache: đổi code không phải cài lại thư viện
COPY pyproject.toml ./
RUN touch README.md && mkdir -p app && touch app/__init__.py \
    && pip install --no-cache-dir -e ".[dev]"

COPY . .
RUN chown -R ailegal:ailegal /srv/backend
USER ailegal

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ─────────────────────────────────────────────────────────────────────────────
# PROD — image bất biến, không mount, không phụ thuộc dev
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS prod

# Bật khi triển khai vòng eContract: convert .docx → PDF cần LibreOffice
# headless. Mặc định tắt vì nó làm image nặng thêm ~400MB.
ARG WITH_LIBREOFFICE=0
RUN if [ "$WITH_LIBREOFFICE" = "1" ]; then \
        apt-get update && apt-get install -y --no-install-recommends \
            libreoffice-writer-nogui fonts-liberation fonts-dejavu \
        && rm -rf /var/lib/apt/lists/*; \
    fi

COPY pyproject.toml ./
RUN touch README.md && mkdir -p app && touch app/__init__.py \
    && pip install --no-cache-dir "."

# Code nằm trong image — không bind mount, không sửa nóng.
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

# Nhãn truy vết: biết chính xác image đang chạy dựng từ commit nào
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=${GIT_SHA} BUILD_TIME=${BUILD_TIME}
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.created=${BUILD_TIME} \
      org.opencontainers.image.title="AI Legal Backend"

RUN chown -R ailegal:ailegal /srv/backend
USER ailegal

# Nhiều worker tiến trình. Không dùng --reload, không mount code.
# Số worker đặt qua biến môi trường để tinh chỉnh theo máy thật.
ENV WEB_CONCURRENCY=4
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 \
     --workers ${WEB_CONCURRENCY} --proxy-headers --forwarded-allow-ips='*' \
     --no-server-header"]
