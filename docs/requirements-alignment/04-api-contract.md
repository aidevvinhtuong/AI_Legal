# 04 — API Contract FE ↔ BE (rút từ code demo)

> Owner: DEV (FE + BE cùng duyệt)
> Nguồn sự thật: `frontend/src/lib/review-service.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/config-service.ts`, `frontend/src/lib/types.ts`, `frontend/src/lib/config-types.ts`.
> FE demo đã viết sẵn nhánh gọi REST khi `NEXT_PUBLIC_USE_MOCK=false`, base URL `NEXT_PUBLIC_API_URL` (mặc định `http://localhost:8000`). Backend chỉ cần implement đúng các endpoint dưới đây là FE chạy được mà không sửa nhiều.

## 1. Quy ước chung

- Auth: header `Authorization: Bearer <token>` (FE lấy từ `localStorage` sau login — cơ chế token thật chốt tại câu hỏi D2).
- Content-Type: JSON, trừ 2 endpoint upload dùng `multipart/form-data`.
- FE xử lý 401 bằng redirect về `/login` (đã có trong `api.ts` — `ApiError`).
- Response của mọi endpoint mutation trên review: trả về **toàn bộ `ContractReview` sau thay đổi** (FE thay thế state bằng object trả về).

## 2. Endpoint đã được FE gọi sẵn

### 2.1. Auth & danh mục

| Method | Path | Body | Response | Ghi chú |
|--------|------|------|----------|---------|
| POST | `/api/auth/login` | `{ username, password }` (FE đã gửi dạng này; demo còn hỗ trợ `{ role }` cho login nhanh) | `UserSession` | Tài khoản demo `admin`/`admin`; cơ chế thật đổi theo quyết định SSO (D2) |
| GET | `/api/contract-types` | — | `ContractTypeConfig[]` | Chỉ bản published |
| GET | `/api/document-categories` | — | `DocumentCategory[]` | |
| GET | `/api/discount-options` | — | `DiscountOption[]` | |
| GET | `/api/business-entities` | — | `CodeLabelOption[]` | |
| GET | `/api/contract-bases` | — | `CodeLabelOption[]` | |
| GET | `/api/contract-names` | — | `CodeLabelOption[]` | |

### 2.2. Review lifecycle

| Method | Path | Body | Ghi chú |
|--------|------|------|---------|
| GET | `/api/reviews` | — | Lọc theo quyền: Purchasing chỉ thấy của mình (A5); Legal thấy tất cả |
| GET | `/api/reviews/{id}` | — | |
| POST | `/api/reviews` | `multipart`: `contract_type_id`, `title`, `prompt`, `intake` (JSON string), `files` (1 file chính), `reference_files[]` | Tạo review, vào queue. FE demo chưa có UI reference files — giữ field cho tương lai |
| POST | `/api/reviews/{id}/advance` | — | Demo dùng để giả lập queue; backend thật thay bằng queue nội bộ + endpoint trạng thái (chốt tại D5: polling hay WebSocket) |
| PATCH | `/api/reviews/{id}/intake` | `{ intake, contractTypeId, prompt }` | Sửa thông tin khai báo |
| POST | `/api/reviews/{id}/submit-queue` | — | Gửi bản nháp vào AI queue |
| POST | `/api/reviews/{id}/chat` | `{ content }` | Response: `{ review, reply }` — reply là `ChatMessage` |
| POST | `/api/reviews/{id}/proposals/{proposalId}` | `{ status: "accepted" \| "undone" }` | Chỉ hợp lệ với proposal Loại A |
| POST | `/api/reviews/{id}/proposals/accept-all` | — | |
| POST | `/api/reviews/{id}/proposals/undo-all` | — | |
| PATCH | `/api/reviews/{id}/document` | `{ text }` | Lưu chỉnh sửa toàn văn bản (vùng mở) + tính lại insight |
| PATCH | `/api/reviews/{id}/sections/{sectionIndex}` | `{ body }` | Lưu chỉnh sửa 1 vùng mở |
| PUT | `/api/reviews/{id}/fields` | `{ fields: EditableField[] }` | Ghi field-level, backend phải enforce allow-list vùng mở (Lớp 1) |
| POST | `/api/reviews/{id}/markers` | `{ recipientId, positionLabel, height }` | Gán marker theo chuẩn FPT.eContract `#ds:id r:p_001_r_001 h:100 #`; validate client-side (`validateMarkers` — theo bảng mã lỗi FPT) — backend validate lại lần 2 |
| PATCH | `/api/reviews/{id}/recipients/{recipientId}` | `Partial<SignRecipient>` | Sửa thông tin người ký (email, orgName, signType…) trước khi đẩy eContract |
| POST | `/api/reviews/{id}/submit-legal` | — | Chặn nếu marker chưa hợp lệ |
| POST | `/api/reviews/{id}/legal-decision` | `{ decision: "approve" \| "reject", feedback: StructuredFeedbackItem[] }` | Approve → trigger đồng bộ Econtract |
| POST | `/api/reviews/{id}/reupload` | `multipart`: `file` | Phương thức 3 (PT3). Validate vùng khoá (port logic `reupload-validation-node.ts`); lỗi trả `ReuploadValidationError` dạng danh sách issue |

### 2.3. Endpoint cần bổ sung (FE chưa viết nhưng bắt buộc cho Sprint 1)

| Nhóm | Endpoint đề xuất | Lý do |
|------|------------------|-------|
| Config checklist | CRUD `/api/config/contract-types`, `/api/config/versions`, `/api/config/clauses`, `/api/config/matrices`, `/api/config/audit`, publish/clone/test-preview | Toàn bộ `config-service.ts` hiện ném `"API chưa sẵn sàng"` khi tắt mock — cần thiết kế đủ mặt cắt tương ứng các hàm export trong file này |
| File | `GET /api/reviews/{id}/files/{versionOrAttachmentId}` | Demo đang trỏ `/samples/*.docx`; cần endpoint tải file thật theo version |
| Queue | `GET /api/reviews/{id}/queue-status` hoặc WebSocket | Thay `advance` giả lập |
| Econtract outbound | Backend gọi 4 API FPT.eContract (login, khởi tạo HĐ excall, lấy link ký, hủy HĐ) — spec chi tiết + payload mẫu trong `07-econtract-integration.md`; FE có `buildEcontractPayload()` làm chuẩn đối chiếu | Tính năng bắt buộc Sprint 1 |
| Econtract inbound | `POST /api/callbacks/econtract` nhận 3 callback FPT (`Recipient_push_info`, `Recipient_finished`, `Flow_finished`) + job đối soát bằng API lấy link ký; kênh sFTP xác nhận tại D1d | Cập nhật trạng thái ký + lưu file hoàn thành vào version history |
| Comment 2 chiều | CRUD `/api/reviews/{id}/comments` (anchor theo field/đoạn, thread reply, trạng thái orphaned) | Rev12 Mục 4.5 — demo chưa có (US-L04) |
| Track Changes Legal | `POST /api/reviews/{id}/legal-edits` + accept/undo từng item | Rev12 Mục 4.5 — demo chưa có (US-L05) |
| System prompts | Giữ như demo: Next API `GET/PUT /api/system-prompts` đọc/ghi `prompts/` — hoặc chuyển về backend nếu app không deploy cùng repo prompts (B7) |

## 3. Data model (nguồn: `types.ts` — giữ nguyên tên field khi thiết kế DB/API)

### 3.1. `ContractReview` (aggregate chính)

Các nhóm field: định danh (`id`, `code`, `title`, `version`), phân loại (`contractTypeId/Label`, `intake: DocumentIntakeMeta`), file (`fileName`, `originalDocxUrl`, `reviewedDocxUrl`, `attachments: ReviewAttachment[]`), nội dung (`originalText`, `reviewedText`), AI (`proposals: AiProposal[]`, `contractInsight: ContractInsight`, `confidence`), tương tác (`messages: ChatMessage[]`, `fields: EditableField[]`, `recipients: SignRecipient[]`, `feedback: StructuredFeedbackItem[]`), trạng thái (`status: ReviewStatus`, `queuePosition`, `ownerName`, `versionHistory: ContractVersionEntry[]`).

### 3.2. State machine `ReviewStatus`

```
draft → queued → processing → reviewed → awaiting_markers → pending_legal
pending_legal → rejected (quay lại vòng sửa, version mới)
pending_legal → approved → syncing_econtract → signed
```

Backend là nơi duy nhất được chuyển trạng thái; FE chỉ đọc.

### 3.3. Các type cần giữ tương thích

- `AiProposal`: `kind: "A" | "B"`, trạng thái accept/undo/annotation, diff cũ→mới, liên kết điều khoản checklist.
- `ContractInsight`: `aiConfidenceScore`, `fairnessScore`, findings 4 nhóm (`red_flag | warning | protection | missing_protection`), summary. (`ConfidenceDetail` đã deprecated — không dùng cho API mới.)
- `SignRecipient` + `MarkerType` (`ds`/`is`/`st`) + `EcontractSignType` — đã mở rộng theo spec FPT.eContract: `partyId`, `orgName`, `isMyOrg`, `email`, `ecRole` (signer/reviewer), `signType`, `refRecipientId` (cho marker st), marker có `height`. Xem mapping đầy đủ trong `07-econtract-integration.md`.
- `StructuredFeedbackItem`: hiện attachment chỉ có `name/size` (mock) — API thật cần lưu file (A4).
- `ContractVersionEntry`: snapshot version (label, actor, file, text) phục vụ xem lại.
- `ChecklistClause`, `ApprovalMatrixConfig`, `ContractTypeConfigVersion`, `ConfigAuditEntry` (từ `config-types.ts`) cho nhóm API config.

## 4. Việc backend phải làm khác demo (không copy hành vi mock)

1. **Không** dùng string-replace cho accept proposal — phải ghi OOXML theo allow-list vùng mở (C4).
2. **Không** dùng công thức heuristic của `contract-insight.ts` — thay bằng công thức chốt tại B2.
3. `POST /api/reviews` phải lưu file bytes thật, không map sang sample.
4. Filter quyền ở `GET /api/reviews` phải enforce server-side (demo đang no-op).
5. Approve → `signed` phải qua Econtract thật + callback, không phải `setTimeout`.
