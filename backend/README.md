# AI Legal — Backend

FastAPI (Python 3.12) + PostgreSQL + Redis + MinIO + Celery.

Đây là backend **duy nhất** của hệ thống. Trước đây thư mục này còn một bản
Node/Express (`src/*.ts`, `package.json`) từ giai đoạn demo; nó đã không được
build, không được chạy và không được import từ 2026-08-12, nên đã gỡ bỏ. Nếu cần
tra cứu, xem lịch sử Git.

## Chạy

Đường chính là Docker Compose ở gốc repo — API, worker, Postgres, Redis và MinIO
phải chạy cùng nhau:

```bash
make up          # dựng cả stack (API: http://localhost:8010)
make logs        # theo dõi log api + frontend
make seed        # nạp tài khoản + master data
```

Chạy trực tiếp trên máy (cần Postgres/Redis/MinIO sẵn có):

```bash
uvicorn app.main:app --reload --port 8000
```

## Nhóm endpoint

Tất cả nằm dưới `/api/v1`. Spec đầy đủ: `GET /openapi.json`, hoặc
[docs/requirements-alignment/04-api-contract.md](../docs/requirements-alignment/04-api-contract.md).

| Prefix | Nội dung |
|--------|----------|
| `/api/v1/auth` | Đăng nhập, đổi mật khẩu, gia hạn phiên, `/me` |
| `/api/v1/reviews` | Vòng đời ticket: tạo, intake, ghi vùng mở, chat, proposals, submit/duyệt, comment, track changes, file, SSE `/events` |
| `/api/v1/templates` | Đăng ký template Legal, lint vùng mở/khoá, đặt tên nghiệp vụ cho `permId` |
| `/api/v1/config` | Checklist theo loại HĐ (cha ∪ con), approval matrix, audit |
| `/api/v1/signing-rules` | Bảng phân quyền ký + `/preview` để thử một tổ hợp điều kiện |
| `/api/v1/users` | Quản trị tài khoản (IT) và `/directory` cho dropdown chọn người ký |
| `/api/v1` (catalogs) | Form lists / danh mục dropdown, kèm bí danh `/document-categories`, `/contract-names`… |
| `/api/v1` (econtract) | Recipients, marker anchors, đẩy FPT.eContract, callback |

## Cấu trúc

- `app/api/routers/` — HTTP handlers, mỏng: validate rồi gọi service
- `app/domain/` — enum, state machine, lỗi nghiệp vụ (không phụ thuộc framework)
- `app/services/` — nghiệp vụ thật: `review/`, `document/` (OOXML), `ai/`,
  `config/`, `econtract/`
- `app/workers/` — Celery: `ai.*`, `econtract.push/drain/reconcile`
- `app/infra/` — model SQLAlchemy, DB, Redis, MinIO, settings
- `alembic/` — migration

## Test

```bash
make test        # toàn bộ (AI chạy nội tuyến, có gọi model thật — chậm)
make test-unit   # chỉ unit, không cần hạ tầng
```

Hai điều dễ vấp:

- **`AI_RUN_INLINE=true` là bắt buộc** cho test integration. Thiếu nó, ticket
  tạo từ template nằm lại ở `processing` (không có worker trong test), và mọi
  lệnh ghi sau đó nhận `423 resource_locked` — trông như lỗi nghiệp vụ nhưng
  thực ra là thiếu biến môi trường. Các target trong Makefile đã set sẵn.
- **Corpus test là `.docx` thật trong repo** (`template/`, `docs/`), resolve qua
  `REPO_ROOT` trong `tests/conftest.py`. Chạy trong container thì hai thư mục đó
  phải được mount vào `/srv` — `docker-compose.yml` đã khai. Thiếu file thì
  `corpus_path()` gọi `pytest.skip`, tức cả nhóm test **lặng lẽ không chạy** thay
  vì báo đỏ; để ý dòng skip trong output.
