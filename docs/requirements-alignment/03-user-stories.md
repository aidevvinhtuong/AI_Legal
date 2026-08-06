# 03 — User Stories Sprint 1 (kèm Acceptance Criteria)

> Owner: BA (soạn) · TESTER (review AC khả năng test) · DEV (review khả thi)
> Cột **Demo**: ✅ = đã có UI demo tham chiếu tại route tương ứng; 🔧 = có service, chưa có UI; ❌ = chưa có gì.
> AC viết dạng Given–When–Then. Story phụ thuộc câu hỏi mở thì ghi `[phụ thuộc Ax/Bx/...]` — chỉ Ready khi câu hỏi đã chốt.
>
> **Cập nhật 06/08/2026 (khớp Blueprint v1.22 + demo):** bỏ A6 fail-fast template; bỏ Legal Lead & Draft/Publish checklist; cấu hình loại cha + overlay tên HĐ opt-in; Form lists Lưu trữ/Xóa theo usage; Task Manager/Legal TH1–TH3; System Prompt 3 stage; nút Quay lại Configurations/Config.

## Epic 1 — Purchasing: Tạo & theo dõi review

### US-P01 — Tạo tài liệu review · Demo ✅ `/dashboard/contracts/new`
Là Purchasing, tôi muốn nhập thông tin hợp đồng (từ Form lists) và upload 1 file `.docx` để gửi AI review.

- **AC1**: Given form thiếu trường bắt buộc (Loại HĐ, Tên HĐ, Công ty, Tên tài liệu, Loại giá trị HĐ, HĐ tiêu chuẩn, Chiết khấu, Giá trị, file) When bấm Submit Then hệ thống chặn và chỉ rõ trường thiếu.
- **AC2**: Given file không phải `.docx` When kéo thả Then file bị từ chối kèm thông báo.
- **AC3**: Given form hợp lệ + 1 file `.docx` When Submit Then review được tạo trạng thái `queued`, điều hướng workspace; Số tài liệu tự sinh `(Mã công ty).(Mã loại HĐ).Năm+STT` — user không sửa được.
- **AC4** `[A6 đã bỏ khỏi Sprint 1]`: Given upload `.docx` hợp lệ Then **không** so khớp nội dung file với template loại HĐ (không fail-fast A6). Cờ `requireTemplateMatch` trên config chỉ là metadata tham chiếu.
- **AC5**: Given Tên HĐ chưa có checklist loại cha đã Lưu When Submit Then cảnh báo “AI review mang tính tham khảo” (vẫn cho vào queue).
- **AC6**: Given chọn Loại HĐ Then dropdown Tên HĐ chỉ hiện tên active thuộc loại đó (Form lists, không hiện đã lưu trữ).

### US-P02 — Theo dõi hàng đợi AI · Demo ✅ (mock queue)
- **AC1**: Given review ở `queued`/`processing` When mở workspace Then thấy vị trí hàng đợi/tiến độ, tự cập nhật không cần reload.
- **AC2** `[A8 đã chốt: FIFO]`: Given queue quá tải Then review vẫn không mất, thứ tự xử lý theo hàng chờ **first-in-first-out**.

### US-P03 — Xem đề xuất AI Loại A/B và Accept/Undo · Demo ✅
- **AC1**: Given AI trả kết quả Then mỗi đề xuất hiển thị loại (A/B), diff cũ→mới, giải thích, điều khoản checklist liên quan.
- **AC2**: Given đề xuất Loại A When Accept/Undo từng cái hoặc tất cả Then nội dung file cập nhật tương ứng và % tin cậy được tính lại.
- **AC3**: Given đề xuất Loại B (vùng khoá) Then chỉ hiển thị annotation/cảnh báo, **không có** nút Accept và không có đường ghi đè nội dung.

### US-P04 — Chat với AI để chỉnh sửa (Phương thức 1) · Demo ✅ (reply mock)
- **AC1**: Given yêu cầu chỉnh sửa nằm trong vùng mở When gửi chat Then AI đề xuất diff mới trên đúng vùng, cập nhật realtime.
- **AC2**: Given yêu cầu đụng vùng khoá Then hệ thống từ chối **trước khi** gọi LLM (write-back allow-list Lớp 1).
- **AC3**: Given nội dung chat chứa chỉ dẫn injection Then AI không tuân theo, gắn Red Flag theo `_shared/injection_guard.md`.
- **AC4** `[C3 đã chốt]`: Given file **không có vùng mở nào** Then AI phản hồi rõ, chỉ hỗ trợ chat + annotation, không ghi file.

### US-P05 — Reupload file sửa offline (Phương thức 3) · Demo 🔧 (service + API có, UI chưa)
- **AC1**: Given review đang ở trạng thái cho phép sửa When Purchasing bấm "Upload lại file đã sửa" và chọn `.docx` Then hệ thống validate cấu trúc vùng khoá so với bản trước.
- **AC2** `[C5 đã chốt: chặn hoàn toàn]`: Given file bị sửa vùng khoá / mất `permStart` / thiếu field Then hiển thị lỗi và **chặn hoàn toàn, không override**.
- **AC3**: Given file hợp lệ Then version bump, chạy lại AI review, lịch sử version ghi nhận.

### US-P06 — Gán marker ký số · Demo ✅ (click-chọn; kéo-thả chưa có)
- **AC1**: Given chưa gán đủ marker cho các bên ký Then nút Submit for approval bị chặn kèm danh sách lỗi.
- **AC2**: Given gán marker When lưu Then sinh đúng cú pháp FPT.eContract (`#ds:id r:p_xxx_r_yyy h:100 #`, tương tự `is`/`st`).
- **AC3** `[A7 đã chốt]`: Given màn gán marker Then Purchasing **kéo-thả marker trên preview** (demo hiện click-chọn; kéo-thả thuộc hoàn thiện Sprint 1).

### US-P07 — Gửi duyệt & xử lý feedback khi bị reject · Demo ✅
- **AC1**: Given đủ marker When Submit for approval Then trạng thái → `pending_manager`; Purchasing Manager thấy ticket trong màn Task.
- **AC2**: Given Manager hoặc Legal reject Then ticket về Task của Purchasing owner kèm comment; Purchasing sửa (TH1 checklist / TH2 Accept Track Changes / TH3 reupload) rồi gửi lại (version mới).
- **AC3** `[A4 đã chốt]`: Given feedback có file đính kèm Then file được lưu và **Purchasing tải được**.

### US-P08 — Chỉ thấy hợp đồng của mình · Demo ✅ `[A5 đã chốt: theo user]`
- **AC1**: Given đăng nhập Purchasing A Then danh sách chỉ gồm HĐ do chính A tạo (hoặc gắn owner A).
- **AC2**: Given Purchasing A mở URL trực tiếp HĐ của B Then bị chặn / không thấy trong list.

### US-P09 — Sửa trực tiếp inline (Phương thức 2) · Demo 🟡 (handler có, editable chưa bật) `[phụ thuộc C6]`
- **AC1**: Given vùng mở trên preview When bôi đen/gõ đè Then nội dung thay đổi, diff tách lớp với diff AI.
- **AC2**: Given vị trí thuộc vùng khoá When cố sửa Then bị chặn (allow-list Lớp 1).
- **AC3**: Given sửa inline Then audit trail ghi nguồn gốc "sửa trực tiếp".

### US-P10 — Lưu thủ công, không autosave (Mục 4.3) · Demo ❌ `[A4c đã chốt]`
- **AC1**: Given có thay đổi chưa lưu When rời trang Then cảnh báo Lưu / Thoát không lưu / Huỷ.
- **AC2**: Given user bấm Lưu Then hỏi xác nhận trước khi ghi.
- **AC3**: Given còn thay đổi chưa lưu Then nút submit bị chặn đến khi lưu.

### US-P11 — Purchasing Manager approve trước Legal · Demo ✅ `/dashboard/tasks` `[A3 đã chốt]`
Là Purchasing Manager, tôi muốn duyệt ticket của nhân viên trước khi gửi Legal.

- **AC1**: Given Purchasing Submit for approval Then ticket vào Task Manager (`pending_manager`); Manager Start → Approve → `pending_legal`.
- **AC2**: Given Manager Reject Then ticket trả Purchasing (Task) kèm lý do/comment; có thể kèm file.
- **AC3**: Given Manager duyệt Then áp dụng cùng TH1 (comment)/TH2 (Track Changes)/TH3 (tải–sửa–upload + Reject) như Legal (Blueprint).
- **AC4**: Role `purchasing_manager`; Task cá nhân — chỉ thấy ticket cần mình xử lý.

## Epic 2 — Legal / Manager: Duyệt hợp đồng

### US-L01 — Màn Task (Purchasing / Manager / Legal) · Demo ✅ `/dashboard/tasks`
- **AC1**: Given đăng nhập Legal và có HĐ `pending_legal` Then Task hiển thị ticket chờ duyệt; bấm **Start** mở chi tiết.
- **AC2**: Given đăng nhập Purchasing Manager và có HĐ `pending_manager` Then Task hiển thị ticket chờ duyệt Manager.
- **AC3**: Given màn chi tiết (Manager/Legal) Then có tab Thông tin chung + AI Review / quyết định Approve·Reject.
- **AC4**: Given Purchasing có ticket bị reject Then Task hiển thị ticket trả về **của chính user**; Start mở workspace.
- **AC5**: **Task cá nhân** — không thấy task người khác. Không có task → trạng thái trống rõ ràng.
- **AC6**: Task Name: dòng 1 = `Số tài liệu - Tên tài liệu`; dòng 2 = Họ tên người yêu cầu.

### US-L02 — Approve / Reject với Structured Feedback · Demo ✅
- **AC1**: Given bấm Từ chối mà chưa nhập comment Then bị chặn.
- **AC2** `[A4 đã chốt]`: Given reject kèm comment + file đính kèm Then feedback lưu đầy đủ; Purchasing tải được.
- **AC3**: Given Manager Approve Then → `pending_legal`. Given Legal Approve Then → đồng bộ Econtract (trace API).
- **AC4** `[TH1/TH2/TH3]`: Manager và Legal đều có đủ 3 trường hợp xử lý khi duyệt (comment / Track Changes / tải–sửa–upload + Reject) theo Blueprint.

### US-L03 — Xem toàn bộ hợp đồng · Demo ✅
- **AC1**: Given đăng nhập Legal (hoặc IT/role có quyền list) Then thấy tất cả HĐ, kèm bộ lọc.
- **AC2**: Nút Quay lại từ Cấu hình HĐ / Configurations về danh sách HĐ (`/dashboard`).

### US-L04 — Comment 2 chiều theo field/đoạn · Demo ❌ `[phụ thuộc A4 / PA-A·PA-B]`
- **AC1**: Given Manager/Legal chọn đoạn When thêm comment Then comment anchor theo vị trí, thread 2 chiều.
- **AC2**: Given đoạn bị xoá Then comment "orphaned" vẫn hiển thị.
- **AC3**: Given nhiều comment Then tổng hợp checklist việc cần sửa cho Purchasing.
- **AC4**: Lưu trữ theo PA-A (gắn version) và/hoặc PA-B (ghi trong .docx) — chốt Tech Design.

### US-L05 — Track Changes (chỉ vùng mở, luôn kèm Reject) · Demo ❌ `[phụ thuộc A4b]`
- **AC1**: Given Manager/Legal tô vùng mở When nhập đề xuất Then sinh diff đỏ/xanh tách lớp với diff AI.
- **AC2**: Given có Track Changes Then chỉ Reject (không Approve kèm sửa).
- **AC3**: Given Purchasing nhận reject Then Accept/Undo từng dòng hoặc cả file, rồi Submit for approval lại.

## Epic 3 — Legal: Cấu hình checklist

### US-C01 — Cấu hình checklist loại HĐ cha · Demo ✅ `/dashboard/config`
Là Legal, tôi muốn soạn checklist Ideal/Fallback/Red Line gắn **Loại hợp đồng** (Form lists) để mọi Tên HĐ con được hưởng.

- **AC1**: Given quyền `contract_config` When mở `/dashboard/config` Then thấy card theo từng Loại HĐ **active** (không hiện loại đã lưu trữ Form lists).
- **AC2**: Given bấm **Cấu hình** trên loại cha When chưa có config Then tạo `ContractTypeConfigVersion` (`configLayer: parent`, `contractTypeId = category.id`).
- **AC3**: Given thêm/sửa điều khoản Then đủ trường: mã tự sinh `CL-xxx` (read-only), tên, Loại, Severity, Ideal/Fallback/Red Line, rationale, keywords/patterns, bật rule/semantic. **Không** còn Content Control, cấp duyệt Fallback, đối tác, GT HĐ tối thiểu trên UI.
- **AC4**: Given bấm Lưu Then cấu hình ghi nhận; AI review dùng bản đã Lưu (không Draft/Publish). Audit trail ghi ai/lúc nào/thay đổi gì.
- **AC5**: Given nút Quay lại Then về danh sách HĐ `/dashboard`.

### US-C05 — Overlay checklist theo Tên HĐ (opt-in) · Demo ✅ `/dashboard/config`
Là Legal, tôi muốn (tuỳ chọn) thêm cấu hình riêng cho một Tên HĐ; AI gộp với checklist loại cha.

- **AC1**: Given loại cha When chưa chọn overlay Then bảng con **không** liệt kê mọi tên Form lists — chỉ hiện tên đã có overlay.
- **AC2**: Given chọn tên trong dropdown “Thêm cấu hình riêng” + Thêm Then tạo overlay (`configLayer: child`) và mở chi tiết.
- **AC3**: Given AI review HĐ có `intake.contractNameId` Then `getMergedConfigForContractName` = cha ∪ con; cùng `clause.code` → bản con thắng; không overlay → chỉ cha.
- **AC4**: Given Xóa overlay When usage = 0 Then overlay bị xóa, tên biến mất khỏi bảng; tên vẫn trên Form lists và vẫn hưởng checklist cha. Usage > 0 → chặn xóa.

### US-C02 — Publish với governance · ❌ **Bỏ khỏi Sprint 1**
- Đã chốt: chỉ **Sửa + Lưu**. Không Draft → Published; không role Legal Lead; không hạng mục quyền Publish checklist.

### US-C03 — Import/Export checklist · ❌ **Bỏ khỏi Sprint 1** `[A10 đã chốt]`
- Legal soạn checklist trực tiếp trên UI (US-C01 / US-C05).

### US-C04 — Quản lý Approval Matrix · Demo 🟡 (metadata / link, chưa CRUD đầy đủ)
- **AC1**: Given cấu hình loại HĐ Then có thể gắn/tham chiếu matrix (global hoặc theo loại) trên list/meta.
- **AC2**: Vai trò matrix với luồng Manager → Legal (routing vs cảnh báo + summary) — chốt Tech Design; demo chưa CRUD matrix đầy đủ.

## Epic 4 — IT: Cấu hình hệ thống

### US-I01 — Quản lý Form lists · Demo ✅ `/dashboard/configurations`
Là IT, tôi muốn quản trị danh mục dropdown form Tạo tài liệu, gồm Lưu trữ an toàn khi đã có giao dịch.

- **AC1**: Given quyền Form lists When sửa Mã/Giá trị (Loại HĐ, Tên HĐ, Công ty, Loại giá trị, HĐ tiêu chuẩn, nhãn Chiết khấu) + Lưu Then form tạo review dùng giá trị mới.
- **AC2**: Given giá trị **chưa** có HĐ dùng When Xóa Then xóa được. Given **đã** có ≥1 HĐ When Xóa Then chặn — chỉ **Lưu trữ**.
- **AC3**: Given Lưu trữ Then giá trị ẩn khỏi dropdown form tạo và list Cấu hình loại HĐ; HĐ cũ giữ tham chiếu.
- **AC4**: Given nút **Đã lưu trữ (n)** trên header từng khối When bật Then hiện dòng archived (ô nhập disabled) + **Bỏ lưu trữ**.
- **AC5**: Given Chiết khấu (yes/no) Then chỉ sửa nhãn — không Thêm/Xóa/Lưu trữ.
- **AC6**: Given nút Quay lại Then về `/dashboard`. User không đủ quyền → redirect.

### US-I02 — Quản lý System Prompt · Demo ✅ `[phụ thuộc B7]`
- **AC1**: Given IT mở tab System prompts Then thấy **3 stage**: `checklist_review` · `chat_edit` · `ai_summary_fairness` (không còn Field validation).
- **AC2**: Given sửa prompt CURRENT Then validate placeholder (`{{checklist_items}}`…) và chặn hardcode nội dung pháp lý trước khi lưu.
- **AC3**: Given thay đổi trên Git Then CI `validate-prompts` phải pass mới merge.

### US-I03 — Users & phân quyền hạng mục · Demo ✅ `/dashboard/users`
- **AC1**: Given IT When tạo/sửa user Then có Họ tên, username, role, tick quyền hạng mục (Task, Danh sách HĐ, Tạo tài liệu, Cấu hình HĐ, Form lists, System prompts, Users…).
- **AC2**: Given user thiếu quyền một hạng mục Then không vào được màn tương ứng.

## Epic 5 — Hệ thống: AI Engine & Tích hợp

### US-S01 — AI Review Engine · Demo 🟡 (mock heuristic; pipeline logic theo Blueprint 1.3.5)
- **AC1**: Given HĐ vào queue Then resolve checklist bằng `getMergedConfigForContractName(contractNameId)` (cha ∪ overlay) + System Prompt `checklist_review` → findings / đề xuất A/B.
- **AC2**: Given LLM lỗi/timeout Then fallback rule-based, đánh dấu rõ `[phụ thuộc B4]`.
- **AC3**: Given có findings Then stage `ai_summary_fairness` sinh summary + fairness; % tin cậy và Fairness Score tách biệt `[B2]`.

### US-S02 — Đồng bộ Econtract (outbound) · Demo ❌ `[phụ thuộc D1a/D1b/D1e]`
- **AC1**: Given Legal approve Then gọi API FPT.eContract đẩy trình ký với marker; file convert base64 `[D1c]`.
- **AC2** `[D1d]`: Kênh nhận file ký về **không thuộc scope** AI Legal.

### US-S03 — Xuất `.docx` giữ format · Demo ❌ `[phụ thuộc C4]`
- **AC1**: Given review hoàn tất When export Then `.docx` giữ format gốc, chỉ thay vùng mở theo allow-list.

## Definition of Ready cho từng story

1. Mọi `[phụ thuộc]` đã có quyết định trong `02-open-questions.md` hoặc Blueprint đã chốt.
2. AC được TESTER xác nhận viết được test case.
3. Story cần API có endpoint tương ứng trong `04-api-contract.md`.
4. UI story có màn hình demo tham chiếu hoặc mockup được duyệt.
5. Story cấu hình checklist / Form lists khớp Blueprint VI.4–VI.5 (v1.22+).
