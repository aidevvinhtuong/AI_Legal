# 03 — User Stories Sprint 1 (kèm Acceptance Criteria)

> Owner: BA (soạn) · TESTER (review AC khả năng test) · DEV (review khả thi)
> Cột **Demo**: ✅ = đã có UI demo tham chiếu tại route tương ứng; 🔧 = có service, chưa có UI; ❌ = chưa có gì.
> AC viết dạng Given–When–Then. Story phụ thuộc câu hỏi mở thì ghi `[phụ thuộc Ax/Bx/...]` — chỉ Ready khi câu hỏi đã chốt.

## Epic 1 — Purchasing: Tạo & theo dõi review

### US-P01 — Tạo tài liệu review · Demo ✅ `/dashboard/contracts/new`
Là Purchasing, tôi muốn nhập thông tin hợp đồng và upload 1 file `.docx` để gửi AI review.

- **AC1**: Given form thiếu trường bắt buộc (loại tài liệu, tên, loại HĐ, contract name, business entity, contract base, chiết khấu, giá trị) When bấm Submit Then hệ thống chặn và chỉ rõ trường thiếu.
- **AC2**: Given file không phải `.docx` When kéo thả Then file bị từ chối kèm thông báo.
- **AC3**: Given form hợp lệ + 1 file `.docx` When Submit Then review được tạo trạng thái `queued`, điều hướng sang workspace, file **thật** của user được lưu và dùng để preview (khác demo hiện tại).
- **AC4** `[phụ thuộc A6]`: Given HĐ khung có cờ "bắt buộc khớp template" và file không khớp Then hệ thống chặn fail-fast kèm lý do.

### US-P02 — Theo dõi hàng đợi AI · Demo ✅ (mock queue)
- **AC1**: Given review ở `queued`/`processing` When mở workspace Then thấy vị trí hàng đợi/tiến độ, tự cập nhật không cần reload.
- **AC2** `[phụ thuộc A8]`: Given queue quá tải Then review vẫn không mất, thứ tự xử lý theo quy tắc đã chốt.

### US-P03 — Xem đề xuất AI Loại A/B và Accept/Undo · Demo ✅
- **AC1**: Given AI trả kết quả Then mỗi đề xuất hiển thị loại (A/B), diff cũ→mới, giải thích, điều khoản checklist liên quan.
- **AC2**: Given đề xuất Loại A When Accept/Undo từng cái hoặc tất cả Then nội dung file cập nhật tương ứng và % tin cậy được tính lại.
- **AC3**: Given đề xuất Loại B (vùng khoá) Then chỉ hiển thị annotation/cảnh báo, **không có** nút Accept và không có đường ghi đè nội dung.

### US-P04 — Chat với AI để chỉnh sửa (Phương thức 1) · Demo ✅ (reply mock)
- **AC1**: Given yêu cầu chỉnh sửa nằm trong vùng mở When gửi chat Then AI đề xuất diff mới trên đúng vùng, cập nhật realtime.
- **AC2**: Given yêu cầu đụng vùng khoá Then hệ thống từ chối **trước khi** gọi LLM (write-back allow-list Lớp 1).
- **AC3**: Given nội dung chat chứa chỉ dẫn injection Then AI không tuân theo, gắn Red Flag theo `_shared/injection_guard.md`.

### US-P05 — Reupload file sửa offline (Phương thức 3) · Demo 🔧 (service + API có, UI chưa)
- **AC1**: Given review đang ở trạng thái cho phép sửa When Purchasing bấm "Upload lại file đã sửa" và chọn `.docx` Then hệ thống validate cấu trúc vùng khoá so với template/bản trước.
- **AC2**: Given file bị sửa vùng khoá / mất `permStart` / thiếu field Then hiển thị danh sách lỗi cụ thể và chặn theo chính sách `[phụ thuộc C5]`.
- **AC3**: Given file hợp lệ Then version bump, chạy lại AI review (vòng review mới), lịch sử version ghi nhận.

### US-P06 — Gán marker ký số · Demo ✅
- **AC1**: Given chưa gán đủ marker cho các bên ký Then nút "Gửi Legal duyệt" bị chặn kèm danh sách lỗi.
- **AC2**: Given gán marker When lưu Then sinh đúng cú pháp Econtract (`#ds:…#`, `#is:…#`, `#st:…#`), validate id/role/không trùng.

### US-P07 — Gửi Legal & xử lý feedback khi bị reject · Demo ✅
- **AC1**: Given đủ marker When "Gửi Legal duyệt" Then trạng thái → `pending_legal`, Legal thấy ticket trong hộp duyệt.
- **AC2**: Given Legal reject Then Purchasing thấy checklist việc cần sửa (Structured Feedback) ngay trên workspace, sửa xong gửi lại tạo version mới.

### US-P08 — Chỉ thấy hợp đồng của mình · Demo ❌ (filter đang no-op) `[phụ thuộc A5]`
- **AC1**: Given đăng nhập Purchasing A Then danh sách chỉ gồm HĐ do A (hoặc nhóm của A, theo quyết định A5) tạo.
- **AC2**: Given Purchasing A mở URL trực tiếp HĐ của B Then bị chặn 403.

### US-P09 — Sửa trực tiếp inline (Phương thức 2) · Demo 🟡 (handler có, editable chưa bật) `[phụ thuộc C6]`
- **AC1**: Given vùng mở trên Cột 3 When bôi đen/gõ đè Then nội dung thay đổi ngay, diff hiển thị tách lớp với diff AI, % tin cậy re-validate realtime.
- **AC2**: Given vị trí thuộc vùng khoá When cố sửa Then bị chặn (allow-list Lớp 1), không có đường ghi đè.
- **AC3**: Given sửa inline Then audit trail ghi nguồn gốc "sửa trực tiếp" (phân biệt chat / upload lại).

### US-P10 — Lưu thủ công, không autosave (Mục 4.3) · Demo ❌ `[phụ thuộc A4c]`
- **AC1**: Given có thay đổi chưa lưu When rời trang/đổi tab Then hiện cảnh báo 3 lựa chọn: Lưu / Thoát không lưu / Huỷ.
- **AC2**: Given còn thay đổi chưa lưu Then nút submit (Gửi AI / Gửi Legal) bị chặn cho đến khi lưu.

## Epic 2 — Legal: Duyệt hợp đồng

### US-L01 — Hộp duyệt 2 bước · Demo ✅ `/dashboard/legal`
- **AC1**: Given có HĐ `pending_legal` Then danh sách ticket hiển thị 2 cột Name/Action, bấm **Start** mở chi tiết.
- **AC2**: Given màn chi tiết Then có 2 tab: "Thông tin chung" (intake read-only + file tải về + quyết định) và "AI Review" (chat read-only + document view, chia ngăn kéo được).
- **AC3**: Given user không có quyền Legal mở URL hộp duyệt Then bị chặn/redirect (demo hiện chỉ toast — phải sửa).

### US-L02 — Approve / Reject với Structured Feedback · Demo ✅
- **AC1**: Given bấm Từ chối mà chưa nhập comment Then bị chặn.
- **AC2** `[phụ thuộc A4]`: Given reject kèm comment + file đính kèm Then feedback lưu đầy đủ (kể cả nội dung file) và Purchasing tải được.
- **AC3**: Given Approve Then trạng thái → đồng bộ Econtract, có trace kết quả gọi API.

### US-L03 — Xem toàn bộ hợp đồng · Demo ✅
- **AC1**: Given đăng nhập Legal Then thấy tất cả HĐ mọi Purchasing, kèm bộ lọc trạng thái/loại.

### US-L04 — Comment 2 chiều theo field/đoạn · Demo ❌ `[phụ thuộc A4]`
- **AC1**: Given Legal (hoặc Purchasing) chọn 1 field/đoạn When thêm comment Then comment anchor theo vị trí (kiểu `w:commentRange`, không theo số dòng), hiển thị trong panel riêng, 2 bên reply được cùng thread.
- **AC2**: Given đoạn được comment bị xoá trong version sau Then comment chuyển trạng thái "orphaned" nhưng vẫn hiển thị.
- **AC3**: Given nhiều comment Then hệ thống tự tổng hợp thành checklist việc cần sửa cho Purchasing.

### US-L05 — Track Changes của Legal (chỉ vùng mở, luôn kèm Reject) · Demo ❌ `[phụ thuộc A4b]`
- **AC1**: Given Legal tô đen text vùng mở When nhập nội dung mới qua popup Then sinh diff đỏ/xanh tách lớp với diff AI (không sửa trực tiếp file).
- **AC2**: Given Legal có track changes Then chỉ được Reject (không có sửa + approve).
- **AC3**: Given Purchasing nhận bản reject Then Accept (ghi giá trị Legal đề xuất) / Undo từng dòng hoặc cả file, và phải chủ động bấm "Gửi Legal duyệt" lại (version bump theo bộ đếm chung).

## Epic 3 — Legal / Legal Lead: Cấu hình checklist

### US-C01 — CRUD checklist theo loại HĐ · Demo ✅ `/dashboard/config`
- **AC1**: Given bản Draft When thêm/sửa điều khoản Then đủ trường: mã, tên, Loại (bắt buộc/cấm/khuyến nghị), Mức độ (Block/cảnh báo cao/thấp), Ideal/Fallback/Red Line, rationale, keywords, điều kiện, field liên kết, cấp duyệt vượt Fallback.
- **AC2**: Given người soạn là Legal (không phải Lead) Then không thấy nút Publish (tách quyền soạn/publish).

### US-C02 — Publish với governance · Demo ✅
- **AC1**: Given Legal Lead publish bản Draft Then bản Published cũ (nếu có) chuyển Archived — mỗi loại HĐ chỉ 1 bản Published.
- **AC2**: Given publish Then audit trail ghi ai/lúc nào/thay đổi gì.

### US-C03 — Import/Export checklist · Demo 🔧 `[phụ thuộc A10]`
- **AC1**: Given bản Draft When Export Then tải file (CSV/XLSX theo quyết định) đúng toàn bộ điều khoản.
- **AC2**: Given file import sai cột/mã trùng Then báo lỗi từng dòng, không ghi đè dữ liệu.

### US-C04 — Quản lý Approval Matrix · Demo 🟡 (chỉ link, chưa CRUD)
- **AC1**: Given quyền phù hợp When tạo/sửa matrix (ngưỡng giá trị ↔ cấp duyệt) Then lưu được và link vào loại HĐ.
- **AC2**: Sprint 1: matrix chỉ ảnh hưởng % tin cậy + cảnh báo, không routing duyệt nhiều cấp `[đã xác nhận tại A3]`.

## Epic 4 — IT: Cấu hình hệ thống

### US-I01 — Quản lý form lists · Demo ✅ `/dashboard/configurations`
- **AC1**: Given role IT When sửa danh sách (loại tài liệu, contract name, business entity, contract base, chiết khấu) Then form tạo review dùng giá trị mới.
- **AC2**: Given role khác IT Then bị redirect khỏi màn Configurations.

### US-I02 — Quản lý System Prompt · Demo ✅ (ghi file thật) `[phụ thuộc B7]`
- **AC1**: Given IT sửa prompt CURRENT của 1 stage Then validate placeholder (`{{checklist_items}}`…) và chặn hardcode heuristic pháp lý trước khi lưu.
- **AC2**: Given prompt thay đổi trên Git Then CI `validate-prompts` phải pass mới merge được.

## Epic 5 — Hệ thống: AI Engine & Tích hợp (backend mới hoàn toàn)

### US-S01 — AI Review Engine thật · Demo ❌ `[phụ thuộc B1–B5]`
- **AC1**: Given HĐ vào queue Then engine chạy 2 tầng: rule-based (keywords checklist) + semantic (LLM so với Ideal), sinh đề xuất A/B đúng schema `AiProposal`.
- **AC2**: Given LLM lỗi/timeout Then fallback rule-based, kết quả đánh dấu rõ là fallback `[phụ thuộc B4]`.
- **AC3**: Given kết quả Then % tin cậy + Fairness + 4 nhóm phát hiện tính theo công thức đã chốt tại B2 (thay heuristic demo).

### US-S02 — Đồng bộ Econtract · Demo ❌ `[phụ thuộc D1]`
- **AC1**: Given Legal approve Then hệ thống gọi API Econtract đẩy trình ký với marker đã gán; lỗi thì retry + báo trạng thái.
- **AC2**: Given Econtract callback file đã ký Then trạng thái → `signed`, file ký được lưu vào version history.

### US-S03 — Xuất `.docx` giữ format · Demo ❌ `[phụ thuộc C4]`
- **AC1**: Given review hoàn tất When export Then file `.docx` giữ format gốc, chỉ thay nội dung vùng mở theo allow-list.

## Definition of Ready cho từng story

1. Mọi `[phụ thuộc]` đã có quyết định trong `02-open-questions.md`.
2. AC được TESTER xác nhận viết được test case.
3. Story cần API có endpoint tương ứng trong `04-api-contract.md`.
4. UI story có màn hình demo tham chiếu hoặc mockup được duyệt.
