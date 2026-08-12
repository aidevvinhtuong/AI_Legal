# AI Legal — Backend

Node/Express API cho các thao tác **server-only** (tách khỏi Next.js UI).

## Endpoints

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/health` | Health check |
| POST | `/api/econtract/push` | Login FPT + chèn marker + PDF + excall |
| POST | `/api/reviews/:id/reupload` | Validate re-upload `.docx` |
| GET/PUT | `/api/system-prompts` | Đọc/ghi file prompts tại repo `/prompts` |

Frontend (`next.config.js`) rewrite `/api/*` → `http://localhost:8000`.

## Chạy local

```bash
cd backend
cp .env.example .env   # điền ECONTRACT_CLIENT_ID / SECRET
npm install
npm run dev            # port 8000
```

Cần LibreOffice (`soffice`) nếu muốn convert PDF trước khi đẩy eContract (không bắt buộc — fallback `.docx`).

## Cấu trúc

- `src/routes/` — HTTP handlers
- `src/services/econtract-file.ts` — chèn marker mực trắng + convert PDF
- `src/lib/econtract-flow.ts` — validate + `buildEcontractPayload` (headerFields đủ 8 + parties)
- `src/lib/system-prompts/` — đọc/ghi `/prompts`
