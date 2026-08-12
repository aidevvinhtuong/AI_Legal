# 04 — API Contract FE ↔ BE (rút từ code demo)

> Owner: DEV (FE + BE cùng duyệt)  
> Nguồn sự thật: `frontend/src/lib/api.ts`, `review-service.ts`, `config-service.ts`, `form-lists-service.ts`, `users-service.ts`, `system-prompts-service.ts`, `types.ts`, `config-types.ts`.  
> Khi `NEXT_PUBLIC_USE_MOCK=false`, FE gọi relative `/api/*` (Next rewrite → `API_REWRITE_URL`, mặc định `http://localhost:8000`). Có thể ghi đè bằng `NEXT_PUBLIC_API_URL` (absolute).

## 1. Quy ước chung

| Quy ước | Chi tiết |
|---------|----------|
| Auth | Header `Authorization: Bearer <token>` (sau login lưu `localStorage`) |
| Content-Type | JSON; upload dùng `multipart/form-data` (không set Content-Type thủ công) |
| 401 | `api.ts` xoá session + redirect `/login` (trừ `skipAuthRedirect` trên login) |
| Lỗi | Body có `error` hoặc `message` hoặc `detail` → `ApiError` |
| Mutation review | Trả **toàn bộ `ContractReview`** sau thay đổi |
| Mock | `NEXT_PUBLIC_USE_MOCK=true` (mặc định): localStorage. `NEXT_PUBLIC_ECONTRACT_LIVE=true`: vẫn gọi BE push eContract khi đang mock data |

## 2. Endpoint FE đã wire sẵn

### 2.1. Auth & danh mục

| Method | Path | Body / query | Response |
|--------|------|--------------|----------|
| POST | `/api/auth/login` | `{ username, password }` hoặc `{ role }` (demo) | `UserSession` |
| POST | `/api/auth/change-password` | `{ username, oldPassword, newPassword }` | ok |
| GET | `/api/contract-types` | — | `ContractTypeConfig[]` (published) |
| GET | `/api/document-categories` | — | `DocumentCategory[]` |
| GET | `/api/discount-options` | — | `DiscountOption[]` |
| GET | `/api/business-entities` | — | `CodeLabelOption[]` |
| GET | `/api/contract-bases` | — | `CodeLabelOption[]` |
| GET | `/api/contract-names` | — | `CodeLabelOption[]` |

### 2.2. Users (IT)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/users` | — | `AppUser[]` |
| POST | `/api/users` | `UserInput` | `AppUser` |
| PUT | `/api/users/{id}` | `UserInput` | `AppUser` |
| DELETE | `/api/users/{id}` | — | 204 / null |

### 2.3. Form lists (IT Configurations)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/form-lists` | — | `FormListsState` |
| PUT | `/api/form-lists` | `FormListsState` | `FormListsState` |

### 2.4. Review lifecycle

| Method | Path | Body | Ghi chú |
|--------|------|------|---------|
| GET | `/api/reviews` | — | Filter quyền server-side |
| GET | `/api/reviews/{id}` | — | |
| POST | `/api/reviews` | `multipart`: `contract_type_id`, `title`, `prompt`, `intake` (JSON), `files` | Tạo HĐ / quick review dùng chung |
| POST | `/api/reviews/{id}/advance` | — | Demo queue; BE thật có thể thay bằng queue-status |
| PATCH | `/api/reviews/{id}/intake` | `{ intake, contractTypeId, prompt }` | |
| POST | `/api/reviews/{id}/submit-queue` | — | |
| POST | `/api/reviews/{id}/chat` | `{ content }` | `{ review, reply }` |
| POST | `/api/reviews/{id}/proposals/{proposalId}` | `{ status: "accepted" \| "undone" }` | |
| POST | `/api/reviews/{id}/proposals/accept-all` | — | |
| POST | `/api/reviews/{id}/proposals/undo-all` | — | |
| PATCH | `/api/reviews/{id}/document` | `{ text }` | |
| PATCH | `/api/reviews/{id}/sections/{sectionIndex}` | `{ body }` | |
| PUT | `/api/reviews/{id}/fields` | `{ fields }` | Enforce allow-list vùng mở |
| POST | `/api/reviews/{id}/markers` | `{ recipientId, positionLabel, height }` | |
| POST | `/api/reviews/{id}/markers/place` | placement payload | Wizard design-markers |
| PATCH | `/api/reviews/{id}/recipients/{recipientId}` | `Partial<SignRecipient>` | |
| PUT | `/api/reviews/{id}/recipients` | `{ recipients }` | Identify-signers save |
| POST | `/api/reviews/{id}/apply-signing-matrix` | `{}` | Legal approve → resolve ma trận |
| POST | `/api/reviews/{id}/submit-legal` | — | |
| POST | `/api/reviews/{id}/manager-decide` | `{ decision, comment }` | |
| POST | `/api/reviews/{id}/legal-decision` | `{ decision, feedback }` | |
| POST | `/api/reviews/{id}/reupload` | `multipart`: `file` | PT3 — validate vùng khoá |

### 2.5. Config checklist / ma trận / audit

| Method | Path | Body / query | Response / ghi chú |
|--------|------|--------------|-------------------|
| GET | `/api/config/versions` | — | `ContractTypeConfigVersion[]` |
| GET | `/api/config/versions/{id}` | — | một version |
| PUT | `/api/config/versions/{id}` | `ContractTypeConfigVersion` | save draft |
| GET | `/api/config/matrices` | — | `ApprovalMatrixConfig[]` |
| GET | `/api/config/audit` | `?contractTypeId=` | `ConfigAuditEntry[]` |
| GET | `/api/config/parent-categories` | — | từ Form lists documentCategories |
| GET | `/api/config/contract-names` | `?categoryId=` | tên HĐ active |
| POST | `/api/config/parent-categories/{categoryId}/ensure` | `{}` | tạo checklist loại cha nếu chưa có |
| POST | `/api/config/contract-names/{contractNameId}/ensure` | `{}` | tạo overlay con |
| POST | `/api/config/contract-types/{id}/archive` | `{}` | archive tên HĐ / overlay |
| POST | `/api/config/parent-categories/{categoryId}/archive` | `{}` | |
| DELETE | `/api/config/contract-types/{id}` | — | xóa overlay |
| DELETE | `/api/config/parent-categories/{categoryId}` | — | |
| POST | `/api/config/contract-types/{id}/restore` | `{}` | |
| POST | `/api/config/parent-categories/{categoryId}/restore` | `{}` | |

Clause CRUD đi qua `saveConfigDraft` (PUT version) — không có endpoint clause riêng trên FE.

### 2.6. Phân quyền ký eContract

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/signing-rules` | — | `SigningAuthorityRule[]` |
| PUT | `/api/signing-rules` | `{ rules: SigningAuthorityRule[] }` | `SigningAuthorityRule[]` |

### 2.7. System prompts & eContract (đã có stub `backend/`)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/system-prompts` | — | `{ prompts: SystemPromptSnapshot[] }` |
| PUT | `/api/system-prompts` | `{ stage, content }` | `{ prompt: SystemPromptSnapshot }` |
| POST | `/api/econtract/push` | `{ reviewId, review, username, password }` | `{ ok, review?, econtract?, message? }` |
| GET | `/health` | — | `{ ok, service }` |

Chi tiết payload FPT: `07-econtract-integration.md`.

## 3. Endpoint Sprint 1 còn thiếu / chưa wire FE

| Nhóm | Endpoint đề xuất | Lý do |
|------|------------------|-------|
| File | `GET /api/reviews/{id}/files/{versionOrAttachmentId}` | Demo đang `/samples/*.docx` |
| Queue | `GET /api/reviews/{id}/queue-status` hoặc WS | Thay `advance` giả lập |
| eContract inbound | `POST /api/callbacks/econtract` | Callback FPT + sFTP |
| Comment 2 chiều | CRUD `/api/reviews/{id}/comments` | US-L04 — UI chưa có |
| Track Changes Legal | `/api/reviews/{id}/legal-edits` | US-L05 — UI chưa có |

## 4. Data model (giữ tên field)

### 4.1. `ContractReview`

Định danh · phân loại (`intake`) · file · nội dung · AI (`proposals`, `contractInsight`) · tương tác (`messages`, `fields`, `recipients`, `feedback`) · trạng thái · `econtract` · `versionHistory`.

### 4.2. State machine `ReviewStatus`

```
draft → queued → processing → reviewed → pending_manager? → pending_legal
pending_legal → rejected | pending_markers
pending_markers → syncing_econtract → signed
```

Backend là nơi duy nhất chuyển trạng thái.

### 4.3. Types tương thích

- `SignRecipient`, marker FPT (`#ds:id r:… h:… #`), `EcontractSignType`
- `ContractInsight` + 4 nhóm finding + Fairness
- `ChecklistClause`, `ContractTypeConfigVersion`, `SigningAuthorityRule`, `FormListsState`, `AppUser`

## 5. Việc BE phải làm khác demo

1. Ghi OOXML theo allow-list vùng mở — không string-replace proposal.
2. Công thức insight/fairness thật (không heuristic demo).
3. `POST /api/reviews` lưu file bytes thật.
4. Filter quyền `GET /api/reviews` server-side.
5. Approve → eContract thật + callback (không `setTimeout` mock).

## 6. Env FE ↔ BE

| Biến | Nơi | Ý nghĩa |
|------|-----|---------|
| `NEXT_PUBLIC_USE_MOCK` | FE | `true` (default) mock localStorage; `false` gọi API |
| `NEXT_PUBLIC_API_URL` | FE | Rỗng = relative `/api` + rewrite; hoặc absolute BE |
| `API_REWRITE_URL` | FE (Next) | Target rewrite, mặc định `http://localhost:8000` |
| `NEXT_PUBLIC_ECONTRACT_LIVE` | FE | `true` = gọi BE push dù đang mock data |
| `ECONTRACT_*` | **backend** | Client id/secret, root, selector, docType — không lộ browser |
