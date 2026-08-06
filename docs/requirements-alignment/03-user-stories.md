# 03 — User Stories Sprint 1 (kèm Acceptance Criteria)

> Owner: BA (soạn) · TESTER (review AC khả năng test) · DEV (review khả thi)
> Cột **Demo**: ✅ = đã có UI demo tham chiếu tại route tương ứng; 🔧 = có service, chưa có UI; ❌ = chưa có gì.
> AC viết dạng Given–When–Then. Story phụ thuộc câu hỏi mở thì ghi `[phụ thuộc Ax/Bx/...]` — chỉ Ready khi câu hỏi đã chốt.
> Cập nhật 04/08/2026: đã phản ánh các quyết định PM chốt trong `02-open-questions.md` (A4–A10, C1–C5, D1c/D1d) và màn **Task** chung thay cho "Hộp duyệt Legal".

## Epic 1 — Purchasing: Tạo & theo dõi review

### US-P01 — Tạo tài liệu review · Demo ✅ `/dashboard/contracts/new`
Là Purchasing, tôi muốn nhập thông tin hợp đồng và upload 1 file `.docx` để gửi AI review.

- **AC1**: Given form thiếu trường bắt buộc (loại tài liệu, tên, loại HĐ, contract name, business entity, contract base, chiết khấu, giá trị) When bấm Submit Then hệ thống chặn và chỉ rõ trường thiếu.
- **AC2**: Given file không phải `.docx` When kéo thả Then file bị từ chối kèm thông báo.
- **AC3**: Given form hợp lệ + 1 file `.docx` When Submit Then review được tạo trạng thái `queued`, điều hướng sang workspace, file **thật** của user được lưu và dùng để preview (khác demo hiện tại).
- **AC4** `[A6 đã chốt: fail-fast]`: Given HĐ khung có cờ "bắt buộc khớp template" và file không khớp Then hệ thống **chặn ngay lúc upload** kèm lý do. Tiêu chí khớp (đề xuất, chờ Legal xác nhận): cấu trúc vùng khoá (số lượng + id Content Control/Range Permission) trùng template gốc + hash nội dung vùng khoá.

### US-P02 — Theo dõi hàng đợi AI · Demo ✅ (mock queue)
- **AC1**: Given review ở `queued`/`processing` When mở workspace Then thấy vị trí hàng đợi/tiến độ, tự cập nhật không cần reload.
- **AC2** `[A8 đã chốt: FIFO]`: Given queue quá tải Then review vẫn không mất, thứ tự xử lý theo hàng chờ **first-in-first-out**, không ưu tiên đặc biệt.

### US-P03 — Xem đề xuất AI Loại A/B và Accept/Undo · Demo ✅
- **AC1**: Given AI trả kết quả Then mỗi đề xuất hiển thị loại (A/B), diff cũ→mới, giải thích, điều khoản checklist liên quan.
- **AC2**: Given đề xuất Loại A When Accept/Undo từng cái hoặc tất cả Then nội dung file cập nhật tương ứng và % tin cậy được tính lại.
- **AC3**: Given đề xuất Loại B (vùng khoá) Then chỉ hiển thị annotation/cảnh báo, **không có** nút Accept và không có đường ghi đè nội dung.

### US-P04 — Chat với AI để chỉnh sửa (Phương thức 1) · Demo ✅ (reply mock)
- **AC1**: Given yêu cầu chỉnh sửa nằm trong vùng mở When gửi chat Then AI đề xuất diff mới trên đúng vùng, cập nhật realtime.
- **AC2**: Given yêu cầu đụng vùng khoá Then hệ thống từ chối **trước khi** gọi LLM (write-back allow-list Lớp 1).
- **AC3**: Given nội dung chat chứa chỉ dẫn injection Then AI không tuân theo, gắn Red Flag theo `_shared/injection_guard.md`.
- **AC4** `[C3 đã chốt]`: Given file **không có vùng mở nào** Then AI phản hồi rõ cho user biết, chỉ hỗ trợ chat + annotation, không ghi file; file có vùng mở thì chỉnh sửa bình thường.

### US-P05 — Reupload file sửa offline (Phương thức 3) · Demo 🔧 (service + API có, UI chưa)
- **AC1**: Given review đang ở trạng thái cho phép sửa When Purchasing bấm "Upload lại file đã sửa" và chọn `.docx` Then hệ thống validate cấu trúc vùng khoá so với template/bản trước.
- **AC2** `[C5 đã chốt: chặn hoàn toàn]`: Given file bị sửa vùng khoá / mất `permStart` / thiếu field Then hiển thị danh sách lỗi cụ thể và **chặn hoàn toàn, không có cơ chế override**.
- **AC3**: Given file hợp lệ Then version bump, chạy lại AI review (vòng review mới), lịch sử version ghi nhận.

### US-P06 — Gán marker ký số · Demo ✅ (click-chọn; kéo-thả chưa có)
- **AC1**: Given chưa gán đủ marker cho các bên ký Then nút "Gửi Legal duyệt" bị chặn kèm danh sách lỗi.
- **AC2**: Given gán marker When lưu Then sinh đúng cú pháp FPT.eContract (`#ds:id r:p_xxx_r_yyy h:100 #`, tương tự `is`/`st`), validate theo 8 rule eContract (id duy nhất, role khớp, height > 0…).
- **AC3** `[A7 đã chốt]`: Given màn gán marker Then Purchasing **kéo-thả marker trên preview** để đặt vị trí (không chỉ click chọn từ danh sách như demo); toạ độ/anchor được lưu để backend chèn marker mực trắng đúng vị trí.

### US-P07 — Gửi Legal & xử lý feedback khi bị reject · Demo ✅
- **AC1**: Given đủ marker When "Gửi Legal duyệt" Then trạng thái → `pending_legal`, Legal thấy ticket trong màn **Task** của mình.
- **AC2**: Given Legal reject Then ticket xuất hiện trong màn **Task** của Purchasing owner (kèm comment Legal); Purchasing thấy checklist việc cần sửa (Structured Feedback) trên workspace, sửa xong gửi lại tạo version mới.
- **AC3** `[A4 đã chốt]`: Given feedback có file đính kèm Then file được lưu và **Purchasing tải được**.

### US-P08 — Chỉ thấy hợp đồng của mình · Demo ❌ (filter đang no-op) `[A5 đã chốt: theo user]`
- **AC1**: Given đăng nhập Purchasing A Then danh sách chỉ gồm ticket/HĐ **do chính A tạo** (scope theo user, không theo phòng ban).
- **AC2**: Given Purchasing A mở URL trực tiếp HĐ của B Then bị chặn 403.

### US-P09 — Sửa trực tiếp inline (Phương thức 2) · Demo 🟡 (handler có, editable chưa bật) `[phụ thuộc C6]`
- **AC1**: Given vùng mở trên Cột 3 When bôi đen/gõ đè Then nội dung thay đổi ngay, diff hiển thị tách lớp với diff AI, % tin cậy re-validate realtime.
- **AC2**: Given vị trí thuộc vùng khoá When cố sửa Then bị chặn (allow-list Lớp 1), không có đường ghi đè.
- **AC3**: Given sửa inline Then audit trail ghi nguồn gốc "sửa trực tiếp" (phân biệt chat / upload lại).

### US-P10 — Lưu thủ công, không autosave (Mục 4.3) · Demo ❌ `[A4c đã chốt: mọi chỉnh sửa + hỏi xác nhận]`
- **AC1**: Given có thay đổi chưa lưu When rời trang/đổi tab Then hiện cảnh báo 3 lựa chọn: Lưu / Thoát không lưu / Huỷ.
- **AC2**: Given user bấm Lưu Then hệ thống **hỏi xác nhận** trước khi ghi thay đổi; áp dụng cho **mọi chỉnh sửa** (không riêng PT2 inline).
- **AC3**: Given còn thay đổi chưa lưu Then nút submit (Gửi AI / Gửi Legal) bị chặn cho đến khi lưu.

### US-P11 — Purchasing Manager approve trước khi tới Legal · Demo ❌ `[A3 đã chốt — Blueprint Hình 2 swimlane]`
Là Purchasing Manager, tôi muốn duyệt ticket của nhân viên mình trước khi gửi Legal.

- **AC1**: Given Purchasing chọn Submit for approval Then ticket vào màn Task của **Purchasing Manager** để Review & Approve; approve rồi mới chuyển Legal (`pending_legal`).
- **AC2**: Given Manager reject (Is approved? = No) Then ticket trả về bước **Review & Adjust** của Purchasing (màn Task), kèm lý do.
- **AC3**: Cần role `purchasing_manager`; phân công ticket theo quy tắc owner/nhóm (chốt cùng A5). Demo chưa có màn hình — ưu tiên Sprint 1 theo Blueprint.

## Epic 2 — Legal: Duyệt hợp đồng

### US-L01 — Màn Task chung (Legal + Purchasing) · Demo ✅ `/dashboard/tasks`
- **AC1**: Given đăng nhập Legal và có HĐ `pending_legal` Then màn Task hiển thị danh sách ticket chờ duyệt (2 cột Name/Action), bấm **Start** mở chi tiết 2 bước.
- **AC2**: Given màn chi tiết (Legal) Then có 2 tab: "Thông tin chung" (intake read-only + file tải về + quyết định) và "AI Review" (chat read-only + document view, chia ngăn kéo được).
- **AC3**: Given đăng nhập Purchasing và có ticket bị Legal reject Then màn Task hiển thị các ticket bị trả về **của chính user đó** kèm comment Legal; bấm **Start** mở thẳng workspace để sửa và gửi lại.
- **AC4**: Given ticket đổi trạng thái (submit → `pending_legal`, reject → trả về) Then ticket tự chuyển sang màn Task của đúng người xử lý tiếp theo.
- **AC5**: **Task là cá nhân** — user chỉ thấy task cần chính mình xử lý, không thấy task của người khác (IT cũng không xem được hàng chờ của Legal/Purchasing). Given user không có task Then hiển thị trạng thái trống "Bạn không có task nào cần xử lý", không render danh sách rỗng của mục khác.

### US-L02 — Approve / Reject với Structured Feedback · Demo ✅
- **AC1**: Given bấm Từ chối mà chưa nhập comment Then bị chặn.
- **AC2** `[A4 đã chốt]`: Given reject kèm comment + file đính kèm Then feedback lưu đầy đủ (kể cả nội dung file) và **Purchasing tải được**.
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

## Epic 3 — Legal: Cấu hình checklist

### US-C01 — CRUD checklist theo loại HĐ · Demo ✅ `/dashboard/config`
- **AC1**: Given quyền Cấu hình hợp đồng When thêm/sửa điều khoản Then đủ trường: mã, tên, Loại (bắt buộc/cấm/khuyến nghị), Mức độ (Block/cảnh báo cao/thấp), Ideal/Fallback/Red Line, rationale, keywords, điều kiện, field liên kết, cấp duyệt vượt Fallback.
- **AC2**: Given đã chỉnh sửa When bấm Lưu Then cấu hình được ghi nhận; AI review dùng bản đã lưu (không workflow Draft/Publish).
- **AC3**: Given thao tác thêm/sửa/xóa/lưu Then audit trail ghi ai/lúc nào/thay đổi gì.

### US-C02 — Publish với governance · ❌ **Bỏ khỏi Sprint 1**
- Đã chốt: Cấu hình hợp đồng chỉ **Sửa + Lưu**. Không Draft → Published → Archived; không tách quyền soạn/publish; không role Legal Lead.

### US-C03 — Import/Export checklist · ❌ **Bỏ khỏi Sprint 1** `[A10 đã chốt]`
- PM quyết định **bỏ Import/Export checklist** khỏi scope Sprint 1 → chuyển backlog. Legal soạn checklist trực tiếp trên UI (US-C01). Template file trao đổi (nếu cần lại) sẽ chốt sau.

### US-C04 — Quản lý Approval Matrix · Demo 🟡 (chỉ link, chưa CRUD)
- **AC1**: Given quyền phù hợp When tạo/sửa matrix (ngưỡng giá trị ↔ cấp duyệt) Then lưu được và link vào loại HĐ.
- **AC2** `[phụ thuộc A3 — đang xác nhận lại]`: A3 mới chốt luồng duyệt **có thêm bước Purchasing Manager approve** trước Legal (khác single-step trước đây); vai trò của matrix (chỉ cảnh báo + % tin cậy hay routing) cần chốt lại theo luồng mới.

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

### US-S02 — Đồng bộ Econtract (outbound) · Demo ❌ `[phụ thuộc D1a/D1b/D1e]`
- **AC1**: Given Legal approve Then hệ thống gọi API FPT.eContract đẩy trình ký với marker đã gán, file **convert base64** khi gửi `[D1c đã chốt]`; lỗi thì retry + báo trạng thái.
- **AC2** `[D1d đã chốt]`: Kênh nhận file ký về **không thuộc scope AI Legal** — hệ thống hiện hữu đã có sẵn. AI Legal chỉ cần gửi HĐ đi ký; trạng thái `signed` (nếu hiển thị) đồng bộ từ hệ thống hiện hữu, không xây callback/sFTP mới.

### US-S03 — Xuất `.docx` giữ format · Demo ❌ `[phụ thuộc C4]`
- **AC1**: Given review hoàn tất When export Then file `.docx` giữ format gốc, chỉ thay nội dung vùng mở theo allow-list.

## Definition of Ready cho từng story

1. Mọi `[phụ thuộc]` đã có quyết định trong `02-open-questions.md`.
2. AC được TESTER xác nhận viết được test case.
3. Story cần API có endpoint tương ứng trong `04-api-contract.md`.
4. UI story có màn hình demo tham chiếu hoặc mockup được duyệt.
