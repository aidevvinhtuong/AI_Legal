# 01 — Gap Analysis: README Rev12 ↔ Demo Frontend

> Owner: BA + DEV · Trạng thái: Draft phục vụ Workshop 1 & 2
> Nguồn: `README.md` (từ Tom_tat_yeu_cau_AI_Review_Hop_dong_Rev12.docx) đối chiếu source code `frontend/` tại thời điểm review.
> Lưu ý thuật ngữ Rev12: **PT1** = Chat AI · **PT2** = sửa trực tiếp inline trên Cột 3 · **PT3** = tải xuống → sửa Word offline → upload lại.

## Chú giải trạng thái

| Ký hiệu | Ý nghĩa |
|---------|---------|
| ✅ Demo | Đã có UI + luồng mô phỏng đầy đủ trên demo (mock backend) |
| 🟡 Mock | Có UI nhưng logic là mock/heuristic — cần build thật ở backend/LLM |
| 🔧 Service-only | Có logic ở tầng service/API route nhưng **chưa có UI** |
| ❌ Chưa có | Chưa hiện diện trong code |
| ⚠️ Mâu thuẫn | README và code mô tả khác nhau — cần chốt trong workshop |

## 1. Ma trận đối chiếu theo nhóm tính năng Sprint 1

| # | Yêu cầu (README) | Trạng thái | Chi tiết / vị trí code |
|---|------------------|-----------|------------------------|
| 1 | Cấu hình loại HĐ: template + checklist cấu trúc + cờ khớp template; Sửa + Lưu (không Draft/Publish) | ✅ Demo | `src/app/dashboard/config/` + `src/lib/config-service.ts`, `config-mock.ts`. Sửa trực tiếp + audit + permission tick `contract_config`. Khi `USE_MOCK=false` toàn bộ Config API ném lỗi `"API chưa sẵn sàng"` |
| 2 | Import/Export checklist Excel | 🔧 Service-only | `exportChecklistCsv` / `importChecklistCsv` có trong `config-service.ts` (CSV, không phải Excel) nhưng **không màn hình nào gọi** |
| 3 | Approval Matrix: ngưỡng ↔ cấp duyệt (Sprint 1 chỉ tính % tin cậy & cảnh báo) | 🟡 Mock | Chỉ **link** matrix có sẵn vào contract type; **chưa có màn hình tạo/sửa matrix**. Ngưỡng ảnh hưởng score qua heuristic trong `review-service.saveFields` |
| 4 | Input + Queue: upload `.docx`, kiểm tra cấu trúc, prompt, hàng đợi LLM Local | 🟡 Mock | `contracts/new` hoạt động nhưng: (a) file upload thật **không được dùng để preview** — luôn map sang `/samples/*.docx`; (b) queue là `setTimeout` giả lập (`advanceQueue`); (c) **không có bước đối chiếu template fail-fast cho HĐ khung khi tạo** — template match chỉ mock bằng regex tên file `ncc_sai_template` |
| 5 | AI Review Engine: checklist + ngữ nghĩa, đề xuất Loại A/B, 4 nhóm phát hiện + Fairness | 🟡 Mock | Đề xuất A/B là dữ liệu seed trong `mock-data.ts`. % tin cậy & Fairness là công thức heuristic trong `contract-insight.ts` (`55 − 22·redFlag − 14·missing − 8·warn + 18·protection`). **Checklist config không thực sự sinh ra proposal** |
| 6 | UI 3 cột + Chat: diff, Accept/Undo Loại A, Loại B annotation | ✅ Demo | `contracts/[id]` + `reviewed-word-view.tsx`, `docx-inline-diff.ts` (diff là DOM overlay trên docx-preview, không ghi OOXML). Chat reply là canned text |
| 7 | Field-level Editing: ghi đúng vùng mở (Range Permission / Content Control / Form Field) | 🟡 Mock một phần | Đọc/phân tích OOXML là **thật** (`docx-content-controls.ts`: `w:sdt`, `w:permStart/End`, `documentProtection`). Nhưng ghi đè chỉ là string-replace trên text mock; handler `onDocumentEdit`/`onSectionEdit` gần như không kích hoạt vì `DocxEmbed` luôn `editable={false}` |
| 8 | PT3: download → sửa offline → reupload = vòng review mới + validate vùng khoá | 🔧 Service-only | Logic validate **thật và tốt** (`reupload-validation.ts`, `reupload-validation-node.ts`, API route `api/reviews/[id]/reupload`) nhưng **không có nút/màn hình reupload nào trên UI** |
| 8b | PT2: sửa trực tiếp inline trên Cột 3 (chỉ vùng mở, re-validate realtime) | 🟡 Mock một phần | Handler `onDocumentEdit`/`onSectionEdit` đã viết ở workspace nhưng `ReviewedWordView` luôn render `DocxEmbed editable={false}` → **PT2 gần như chưa hoạt động trên UI** |
| 8c | Lưu thủ công (Mục 4.3): không autosave, cảnh báo thoát khi chưa lưu, bắt buộc lưu trước submit | ❌ Chưa có | Demo lưu ngay mỗi thao tác (autosave qua service); chưa có dialog Lưu / Thoát không lưu / Huỷ |
| 9 | Marker ký số: gán & validate trước khi gửi Legal, chặn submit khi thiếu | ✅ Demo | `marker-panel.tsx` + `validateMarkers`. Gán bằng click chọn vị trí (chưa phải kéo-thả như README mô tả) |
| 10 | Re-validate + Popup % tin cậy / Fairness / 4 nhóm phát hiện | ✅ Demo (score mock) | `contract-insight-popup.tsx` đầy đủ UI; số liệu từ heuristic |
| 11 | Legal Review: approve/reject + Structured Feedback | ✅ Demo một phần | `legal/legal-inbox.tsx` (2 bước: danh sách ticket → chi tiết dạng tab Thông tin chung / AI Review). Reject bắt buộc comment; file đính kèm feedback **chỉ lưu name/size** (không lưu nội dung file) |
| 11b | Comment 2 chiều theo field/đoạn (anchor kiểu `w:commentRange`, orphaned-safe), panel riêng, tự tổng hợp checklist | ❌ Chưa có | Demo chỉ có 1 comment tổng khi reject; chưa có thread 2 chiều Purchasing ↔ Legal |
| 11c | Track Changes của Legal (tô đen → popup nhập nội dung mới, chỉ vùng mở, luôn kèm Reject; diff tách lớp với diff AI) | ❌ Chưa có | Không có UI/logic nào cho Legal đề xuất sửa |
| 12 | Interface Econtract: đẩy trình ký (API một chiều) + nhận file đã ký về qua **sFTP**/callback | 🟡 Mock | `legalDecide` approve → `setTimeout` chuyển `signed`. Chưa có spec API/sFTP thật |
| 13 | Audit / Version / RBAC | ✅ Demo | Version history + snapshot xem lại; audit config tách audit HĐ; RBAC 4 role (`roles.ts`). **Lưu ý:** filter "Purchasing chỉ thấy HĐ của mình" là no-op (`ownerName.includes(...) \|\| true` trong `review-service.listReviews`) |
| 14 | System Prompt (Git): 4 stage + injection guard | ✅ Demo | `prompts/` đủ 4 stage + `_shared/injection_guard.md`; CI validate (`scripts/validate-prompts.js`, GitHub Action). **Nhưng prompts chưa được nối vào luồng AI nào** (chat/insight không dùng prompt) |
| 15 | Export + Disclaimer: `.docx` giữ format, disclaimer trên UI | 🟡 Mock | Download trả về file sample hoặc export text tạm. Chưa có pipeline ghi OOXML giữ format. Disclaimer đã có trên UI |
| 16 | Auth / phân quyền đăng nhập | 🟡 Mock | `login/page.tsx` có form tài khoản/mật khẩu (demo `admin`/`admin`, validate mock) + login nhanh theo role; chưa nối SSO/credential thật (D2) |
| 17 | Fallback rule-based khi LLM sự cố | ❌ Chưa có | Không có code nào thể hiện cơ chế fallback |
| 18 | Processing Queue chịu tải vài trăm HĐ/tháng | ❌ Chưa có | Chỉ có UI trạng thái queue; không có hạ tầng queue |

## 2. Mâu thuẫn README ↔ code cần chốt (⚠️)

| # | Điểm mâu thuẫn | README nói | Code thực tế | Đề xuất / trạng thái |
|---|----------------|-----------|--------------|---------------------|
| M1 | Placeholder prompt | `{{checklist}}` | `{{checklist_items}}` (validator chỉ chấp nhận token này) | ✔ Đã sửa README theo code |
| M2 | Quyền sửa System Prompt | MVP "app có thể xem **read-only**" | IT **sửa được** prompt qua `/dashboard/configurations?tab=system-prompts`, ghi thẳng file qua API route (có validate + CI) | ✔ Đã cập nhật README theo hướng IT sửa được — xác nhận lại tại B7 |
| M3 | Con trỏ version prompt | `CURRENT` | Trên disk chỉ có `current.json` (loader hỗ trợ cả 2) | ✔ Đã sửa README, chuẩn hoá `current.json` |
| M4 | Gán marker | "UI kéo-thả/click" | Chỉ click chọn vị trí | Chốt: click đủ cho Sprint 1? |
| M5 | Import/Export checklist | "Excel" | Service là CSV | Chốt định dạng (CSV thường đủ, mở được bằng Excel) |
| M6 | 2 màn hình admin | Không phân biệt | `/dashboard/config` (Legal: checklist/matrix) tách khỏi `/dashboard/configurations` (IT: form lists + prompts); `/dashboard/system-prompts` chỉ còn là redirect | Ghi nhận thiết kế 2 surface này vào tài liệu yêu cầu |
| M7 | Structured Feedback | Comment 2 chiều theo field + Track Changes của Legal (Mục 4.5) | Chỉ 1 comment tổng khi reject | Khoảng cách lớn — xem hàng 11b/11c; ưu tiên thiết kế UX trong giai đoạn này |
| M8 | Nhận file đã ký | Qua **sFTP**/callback | Mock `setTimeout` | Chốt cơ chế sFTP tại D1 |

## 3. Khoảng trống kiến trúc (chưa có trong repo, phải làm mới hoàn toàn)

1. **Backend thật**: toàn bộ API trong `04-api-contract.md` — hiện FE gọi `NEXT_PUBLIC_API_URL` (mặc định `http://localhost:8000`) nhưng chưa có server nào.
2. **LLM Local + pipeline AI**: chưa có; mọi output AI là seed data.
3. **Lưu trữ file**: hiện là localStorage + URL sample; cần object storage + versioning file thật.
4. **Hạ tầng queue** (vài trăm HĐ/tháng, dồn cuối tháng/quý).
5. **Tích hợp Econtract 2 chiều** (API + callback/webhook).
6. **Auth/SSO** và mapping role thật.
7. **Pipeline ghi OOXML giữ format** (write-back allow-list Lớp 1 mới chỉ có phần đọc).

## 4. Tài sản demo tái sử dụng được cho sản phẩm thật

- Phân tích OOXML vùng khoá/vùng mở: `docx-content-controls.ts` (port sang backend được).
- Validate reupload: `reupload-validation-node.ts` đã chạy được phía server (Node).
- Bộ prompt 4 stage + injection guard + CI validate.
- Data model `types.ts` — làm cơ sở cho API contract.
- Toàn bộ UI/UX flow — làm prototype thống nhất yêu cầu với stakeholder.
