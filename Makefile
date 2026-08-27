# AI Legal — lệnh phát triển.
#   make            xem danh sách lệnh
#
# .venv local chạy Python 3.10 (máy dev không có 3.12) — dùng cho vòng lặp
# nhanh trên services/document và services/ai. Container chạy 3.12 như TS-01.

SHELL     := /bin/bash
VENV      := .venv
PY        := $(VENV)/bin/python
PIP       := $(VENV)/bin/pip
PYTEST    := $(VENV)/bin/pytest
# Database riêng cho test integration — xem tests/conftest.py::pytest_collection_modifyitems
TEST_DB_URL := postgresql+psycopg://ailegal:ailegal@postgres:5432/ailegal_test
RUFF      := $(VENV)/bin/ruff
COMPOSE   := docker compose
BACKEND   := backend

.DEFAULT_GOAL := help

# ── Trợ giúp ──────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo "AI Legal — lệnh phát triển"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── Thiết lập ─────────────────────────────────────────────────────────────
.PHONY: venv
venv: ## Tạo .venv và cài phụ thuộc
	@test -d $(VENV) || python3 -m venv $(VENV)
	$(PIP) install --quiet --upgrade pip
	$(PIP) install --quiet -e "$(BACKEND)[dev]"
	@echo "venv sẵn sàng: $$($(PY) -V)"

.PHONY: env
env: ## Tạo .env từ .env.example nếu chưa có
	@test -f .env || (cp .env.example .env && echo "Đã tạo .env — NHỚ đổi SECRET_KEY")
	@test -f .env && echo ".env đã có"

# ── Docker ────────────────────────────────────────────────────────────────
.PHONY: up
up: env ## Dựng cả stack DEV (postgres, redis, minio, api, frontend) — sửa code là tự nạp lại
	$(COMPOSE) up -d --build
	@echo "Frontend: http://localhost:$${FRONTEND_PORT:-3001}"
	@echo "API:      http://localhost:$${API_PORT:-8010}/docs"
	@echo "MinIO:    http://localhost:$${MINIO_CONSOLE_PORT:-9101}"

.PHONY: up-worker
up-worker: env ## Như `make up` nhưng bật thêm Celery worker (cần từ G4)
	$(COMPOSE) --profile worker up -d --build

.PHONY: infra
infra: env ## Chỉ dựng postgres, redis, minio (chạy api/worker ở local)
	$(COMPOSE) up -d postgres redis minio minio-init

.PHONY: down
down: ## Dừng toàn bộ (giữ nguyên dữ liệu)
	$(COMPOSE) down

.PHONY: logs
logs: ## Theo dõi log api + frontend
	$(COMPOSE) logs -f api frontend

.PHONY: logs-fe
logs-fe: ## Chỉ log frontend
	$(COMPOSE) logs -f frontend

.PHONY: ps
ps: ## Trạng thái container
	$(COMPOSE) ps

.PHONY: shell
shell: ## Vào shell container api
	$(COMPOSE) exec api bash

# ── Production / UAT ──────────────────────────────────────────────────────
# Image dựng từ stage `prod`: code nằm trong image, không mount, nhiều worker.
PROD := $(COMPOSE) -f docker-compose.prod.yml

.PHONY: prod-build
prod-build: ## Dựng image prod (gắn nhãn commit đang checkout)
	GIT_SHA=$$(git rev-parse --short HEAD) \
	BUILD_TIME=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
	$(PROD) build

.PHONY: prod-up
prod-up: ## Chạy stack prod (migration chạy trước, api chờ nó xong)
	GIT_SHA=$$(git rev-parse --short HEAD) \
	BUILD_TIME=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
	$(PROD) up -d --build

.PHONY: prod-down
prod-down: ## Dừng stack prod (GIỮ nguyên dữ liệu)
	$(PROD) down

.PHONY: prod-logs
prod-logs: ## Theo dõi log api + worker của prod
	$(PROD) logs -f api worker

.PHONY: prod-ps
prod-ps: ## Trạng thái container prod
	$(PROD) ps

.PHONY: prod-migrate
prod-migrate: ## Chạy lại migration trên stack prod
	$(PROD) run --rm migrate

# ── Cơ sở dữ liệu ─────────────────────────────────────────────────────────
.PHONY: migrate
migrate: ## Chạy migration lên bản mới nhất
	cd $(BACKEND) && ../$(VENV)/bin/alembic upgrade head

.PHONY: revision
revision: ## Sinh migration mới:  make revision m="mô tả"
	cd $(BACKEND) && ../$(VENV)/bin/alembic revision --autogenerate -m "$(m)"

.PHONY: downgrade
downgrade: ## Lùi 1 bản migration
	cd $(BACKEND) && ../$(VENV)/bin/alembic downgrade -1

.PHONY: seed
seed: ## Nạp dữ liệu mẫu (user, loại HĐ, template HDDV)
	cd $(BACKEND) && ../$(PY) -m app.seed

# ── Kiểm thử ──────────────────────────────────────────────────────────────
.PHONY: test
test: ## Chạy toàn bộ test (AI chạy nội tuyến, có gọi model thật)
	cd $(BACKEND) && AI_RUN_INLINE=true ../$(PYTEST) -q

.PHONY: test-unit
test-unit: ## Chỉ unit test (không cần hạ tầng)
	cd $(BACKEND) && AI_RUN_INLINE=true ../$(PYTEST) -q -m "not integration and not fidelity and not models"

.PHONY: test-fx
test-fx: ## Test giữ format trên .docx thật
	cd $(BACKEND) && ../$(PYTEST) -q -m fidelity -v

.PHONY: test-editor-parity
test-editor-parity: ## Text SuperDoc phải khớp text backend (chạy lại khi nâng cấp SuperDoc)
	./scripts/check-editor-text-parity.sh

.PHONY: test-fe
test-fe: ## Test frontend (vitest + jsdom) — chạy trong container
	docker compose exec -T frontend npx vitest run

.PHONY: test-be
test-be: ## Test backend trên database RIÊNG (ailegal_test) — không đụng dữ liệu dev
	@echo "→ Dựng database ailegal_test (nếu chưa có)…"
	@docker compose exec -T postgres psql -U ailegal -d postgres -tAc \
	   "SELECT 1 FROM pg_database WHERE datname='ailegal_test'" | grep -q 1 \
	   || docker compose exec -T postgres createdb -U ailegal ailegal_test
	@echo "→ Migrate + seed database test…"
	@docker compose exec -T -e DATABASE_URL=$(TEST_DB_URL) api alembic upgrade head >/dev/null
	@docker compose exec -T -e DATABASE_URL=$(TEST_DB_URL) api python -m app.seed >/dev/null
	@echo "→ Chạy pytest…"
	@docker compose exec -T -e DATABASE_URL=$(TEST_DB_URL) -e AI_RUN_INLINE=true api \
	   python -m pytest tests/ -q --no-header -m "not models"

.PHONY: test-be-reset
test-be-reset: ## Xoá sạch database test rồi dựng lại từ đầu
	@docker compose exec -T postgres dropdb -U ailegal --if-exists ailegal_test
	@$(MAKE) test-be

.PHONY: typecheck-fe
typecheck-fe: ## Typecheck frontend — chạy trong container
	docker compose exec -T frontend npx tsc --noEmit

.PHONY: snapshot-routes
snapshot-routes: ## Cập nhật ảnh chụp route backend cho contract test FE
	docker compose exec -T api python -c "\
from app.main import app; import json; \
spec = app.openapi(); \
routes = sorted((m.upper()+' '+p) for p, ops in spec['paths'].items() for m in ops if m in ('get','post','put','patch','delete')); \
print(json.dumps({'generatedFrom':'backend app.main:app','routes':routes}, ensure_ascii=False, indent=2))" \
	  > frontend/src/test/contract/backend-routes.json
	@echo "Đã cập nhật frontend/src/test/contract/backend-routes.json"

.PHONY: cov
cov: ## Test kèm báo cáo độ phủ
	cd $(BACKEND) && ../$(PYTEST) -q --cov=app --cov-report=term-missing

# ── Chất lượng mã ─────────────────────────────────────────────────────────
.PHONY: lint
lint: ## ruff + kiểm ranh giới kiến trúc
	$(RUFF) check $(BACKEND)
	cd $(BACKEND) && ../$(VENV)/bin/lint-imports

.PHONY: fmt
fmt: ## Định dạng lại mã
	$(RUFF) format $(BACKEND)
	$(RUFF) check --fix $(BACKEND)

# ── Công cụ chẩn đoán ─────────────────────────────────────────────────────
.PHONY: check-models
check-models: ## Kiểm chứng 3 endpoint LLM / embedding / rerank
	python3 scripts/check-llm.py

.PHONY: check-ports
check-ports: ## Xem cổng nào đang bị chiếm trên máy
	python3 scripts/check-ports.py

.PHONY: demo-reset
demo-reset: ## Xoá dữ liệu hợp đồng để test tay cho sạch (GIỮ cấu hình). Thêm y=1 để xoá thật
	$(COMPOSE) cp scripts/demo-reset.py api:/tmp/demo-reset.py
	$(COMPOSE) exec -T api python /tmp/demo-reset.py $(if $(y),--yes,)

.PHONY: audit-templates
audit-templates: ## Kiểm định template hợp đồng có đạt chuẩn không
	python3 scripts/audit-templates.py

.PHONY: inspect
inspect: ## Soi cấu trúc 1 file .docx:  make inspect f=path/to.docx
	python3 scripts/inspect-template.py "$(f)"

# ── Chạy local (không qua Docker) ─────────────────────────────────────────
.PHONY: dev
dev: ## Chạy API ở local, dùng hạ tầng trong Docker
	cd $(BACKEND) && ../$(VENV)/bin/uvicorn app.main:app --reload --port $${API_PORT:-8010}

.PHONY: dev-worker
dev-worker: ## Chạy Celery worker ở local
	cd $(BACKEND) && ../$(VENV)/bin/celery -A app.workers.celery_app worker \
	  -Q ai,interactive,io -c 2 --prefetch-multiplier=1 -l INFO

.PHONY: test-fast
test-fast: ## Test không gọi endpoint model (nhanh, dùng cho CI)
	cd $(BACKEND) && AI_SEMANTIC_ENABLED=false AI_RUN_INLINE=true ../$(PYTEST) -q
