# API Contract FE ↔ BE

Spec đầy đủ (endpoint, env, data model): **[requirements-alignment/04-api-contract.md](./requirements-alignment/04-api-contract.md)**

eContract payload / FPT: **[requirements-alignment/07-econtract-integration.md](./requirements-alignment/07-econtract-integration.md)**

## Chế độ chạy nhanh

| Mục tiêu | FE | BE |
|----------|----|----|
| Demo UI | `NEXT_PUBLIC_USE_MOCK=true` | không bắt buộc |
| Demo + push eContract | `USE_MOCK=true` + `NEXT_PUBLIC_ECONTRACT_LIVE=true` | `backend/` `:8000` |
| Đấu nối full API | `NEXT_PUBLIC_USE_MOCK=false` | implement §2 trong `04-api-contract.md` |

FE mặc định gọi relative `/api/*` (Next rewrite → `API_REWRITE_URL`).
