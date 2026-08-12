# 03 — User Stories Sprint 1 (kèm Acceptance Criteria)

> Owner: BA (soạn) · TESTER (review AC khả năng test) · DEV (review khả thi)  
> Cột **Demo**: ✅ = đã có UI demo tham chiếu tại route tương ứng; 🔧 = có service, chưa có UI; ❌ = chưa có gì; **Bỏ** = ngoài phạm vi Sprint 1 (Blueprint VII).  
> AC viết dạng Given–When–Then. Story phụ thuộc câu hỏi mở thì ghi `[phụ thuộc Ax/Bx/...]` — chỉ Ready khi câu hỏi đã chốt.
>
> **Cập nhật 12/08/2026 (khớp Blueprint v1.28 + demo):** Review hợp đồng (US-P12); marker/eContract sau Legal (`pending_markers`); PT2/PT3 & UI TH1·TH2·TH3 / PA-A·PA-B → VII; Phân quyền ký eContract; Legal Approve ≠ đẩy eContract ngay; System Prompt qua `backend/`; API contract FE sẵn sàng đấu nối.

## Epic 1 — Purchasing: Tạo & theo dõi review

### US-P01 — Tạo tài liệu review · Demo ✅ `/dashboard/contracts/new`
Là Purchasing, tôi muốn nhập thông tin hợp đồng (từ Form lists) và upload 1 file `.docx` để gửi AI review (luồng đầy đủ: duyệt → gán chữ ký → eContract).

- **AC1**: Given form thiếu trường bắt buộc (Loại HĐ, Tên HĐ, Công ty, Tên tài liệu, Loại giá trị HĐ, HĐ tiêu chuẩn, Chiết khấu, Giá trị, file) When bấm Submit Then hệ thống chặn và chỉ rõ trường thiếu.
- **AC2**: Given file không phải `.docx` When kéo thả Then file bị từ chối kèm thông báo.
- **AC3**: Given form hợp lệ + 1 file `.docx` When Submit Then review được tạo trạng thái `queued`, điều hướng workspace; Số tài liệu tự sinh `(Mã công ty).(Mã loại HĐ).Năm+STT` — user không sửa được.
- **AC4** `[A6 đã bỏ khỏi Sprint 1]`: Given upload `.docx` hợp lệ Then **không** so khớp nội dung file với template loại HĐ (không fail-fast A6). Cờ `requireTemplateMatch` trên config chỉ là metadata tham chiếu.
- **AC5**: Given Tên HĐ chưa có checklist loại cha đã Lưu When Submit Then cảnh báo “AI review mang tính tham khảo” (vẫn cho vào queue).
- **AC6**: Given chọn Loại HĐ Then dropdown Tên HĐ chỉ hiện tên active thuộc loại đó (Form lists, không hiện đã lưu trữ).

### US-P12 — Review hợp đồng (chỉ AI review) · Demo ✅ `/dashboard/review`
Là Purchasing, tôi muốn upload nhanh Loại HĐ + Tên HĐ + `.docx` để **chỉ** làm việc với AI (chat / Accept·Undo), không Submit duyệt và không eContract.

- **AC1**: Given đã đăng nhập quyền contracts / contracts_create When mở `/dashboard/review` Then bắt buộc chọn Loại hợp đồng + Tên hợp đồng (lọc theo loại) trước khi enable «Bắt đầu AI Review».
- **AC2**: Given đã chọn Loại + Tên + 1 file `.docx` When bấm Bắt đầu AI Review Then tạo ticket → `queued`/`processing` → workspace `/dashboard/review/[id]` (chat + tài liệu, Accept/Undo, insight).
- **AC3**: Given ticket từ Review hợp đồng When xem Danh sách HĐ (nếu có) Then có thể thấy bản ghi tham chiếu với owner; hành vi chính vẫn là workspace review — **không** dùng để Submit duyệt.
- **AC4**: Given đang ở `/dashboard/review/[id]` When bấm Upload mới Then về `/dashboard/review`. Không có nút Submit duyệt / Gán chữ ký trên màn này.
- **AC5**: Given ticket từ Review hợp đồng When hoàn tất xem/chỉnh trên workspace Then **không** có bước tiếp theo trong Sprint 1 (không `pending_manager` / `pending_legal` / `pending_markers` / eContract). Muốn trình ký → dùng **Tạo tài liệu** (US-P01) + Submit duyệt.

### US-P02 — Theo dõi hàng đợi AI · Demo ✅ (mock queue)
- **AC1**: Given review ở `queued`/`processing` When mở workspace Then thấy vị trí hàng đợi/tiến độ, tự cập nhật không cần reload.
- **AC2** `[A8 đã chốt: FIFO]`: Given queue quá tải Then review vẫn không mất, thứ tự xử lý theo hàng chờ **first-in-first-out**.

### US-P03 — Xem đề xuất AI Loại A/B và Accept/Undo · Demo ✅
- **AC1**: Given AI trả kết quả Then mỗi đề xuất hiển thị loại (A/B), diff cũ→mới, giải thích, điều khoản checklist liên quan.
- **AC2**: Given đề xuất Loại A When Accept/Undo từng cái hoặc tất cả Then nội dung file cập nhật tương ứng và % tin cậy được tính lại.
- **AC3**: Given đề xuất Loại B (vùng khoá) Then chỉ hiển thị annotation/cảnh báo, **không có** nút Accept và không có đường ghi đè nội dung.

### US-P04 — Chat với AI để chỉnh sửa (PT1) · Demo ✅ (reply mock)
- **AC1**: Given yêu cầu chỉnh sửa nằm trong vùng mở When gửi chat Then AI đề xuất diff mới trên đúng vùng, cập nhật realtime.
- **AC2**: Given yêu cầu đụng vùng khoá Then hệ thống từ chối **trước khi** gọi LLM (write-back allow-list Lớp 1).
- **AC3**: Given nội dung chat chứa chỉ dẫn injection Then AI không tuân theo, gắn Red Flag theo `_shared/injection_guard.md`.
- **AC4** `[C3 đã chốt]`: Given file **không có vùng mở nào** Then AI phản hồi rõ, chỉ hỗ trợ chat + annotation, không ghi file.

### US-P05 — Reupload file sửa offline (PT3) · ❌ **Bỏ khỏi Sprint 1** (Blueprint VII)
- Sprint 1 chỉ **PT1 Chat**. Service/API reupload có sẵn để phase sau; **không** deliver UI PT3 trong Sprint 1.

### US-P06 — Xác định người ký & gán marker (sau Legal) · Demo ✅
- **AC1**: Given Legal approve Then status → `pending_markers`; Task người tạo hiện nút **Gán chữ ký** — **không** chặn Submit duyệt vì thiếu marker.
- **AC2**: Given mở `/identify-signers` Then bên mua prefill từ ma trận Phân quyền ký (tên org read-only; thêm/sửa/xóa người); phải **Thêm bên ký** (≥1 đối tác); mỗi đối tác bắt buộc chọn Tổ chức|Cá nhân; chỉ **Ký chính** + **Văn thư** cần marker ở bước sau.
- **AC3**: Given `/design-markers` When kéo-thả loại ký + chọn Người nhận + kích thước Then lưu tọa độ %; cú pháp `#ds/#is … h:… #`; Submit chặn nếu thiếu marker Ký chính/Văn thư.
- **AC4**: Given Submit đủ marker Then Word+marker → PDF/base64 → `POST /api/econtract/push` (BE); lưu `envelopeId` / trạng thái tích hợp.

### US-P07 — Gửi duyệt & xử lý feedback khi bị reject · Demo ✅
- **AC1**: Given đã lưu chỉnh sửa When Submit for approval Then trạng thái → `pending_manager` (nếu có Line Manager) hoặc `pending_legal` — **không** yêu cầu marker.
- **AC2**: Given Manager hoặc Legal reject Then ticket về Task của Purchasing owner kèm comment; Purchasing sửa trên workspace (PT1) rồi gửi lại (version mới).
- **AC3** `[A4 đã chốt — phạm vi Sprint 1]`: Reject cơ bản kèm comment (+ file đính kèm nếu có) là đủ. UI chi tiết TH1/TH2/TH3 + PA-A/PA-B → **VII ngoài phạm vi**.

### US-P08 — Chỉ thấy hợp đồng của mình · Demo ✅ `[A5 đã chốt: theo user]`
- **AC1**: Given đăng nhập Purchasing A Then danh sách chỉ gồm HĐ do chính A tạo (hoặc gắn owner A).
- **AC2**: Given Purchasing A mở URL trực tiếp HĐ của B Then bị chặn / không thấy trong list.

### US-P09 — Sửa trực tiếp inline (PT2) · ❌ **Bỏ khỏi Sprint 1** (Blueprint VII)
- Sprint 1 chỉ **PT1 Chat**. Handler demo có thể giữ; không bật editable / không AC deliver PT2.

### US-P10 — Lưu thủ công, không autosave (Mục 4.3) · Demo 🟡 `[A4c đã chốt]`
- **AC1**: Given có thay đổi chưa lưu When rời trang / đổi bước wizard Then cảnh báo Lưu / Thoát không lưu / Huỷ (áp dụng tối thiểu luồng Gán chữ ký).
- **AC2**: Given còn thay đổi chưa lưu Then nút chuyển bước / Submit bị chặn đến khi lưu (wizard identify-signers / design-markers).
- **AC3**: Phạm vi đầy đủ “mọi chỉnh sửa trên workspace không autosave” — hoàn thiện theo Tech Design; demo hiện một phần autosave trên AI workspace.

### US-P11 — Purchasing Manager approve trước Legal · Demo ✅ `/dashboard/tasks` `[A3 đã chốt]`
Là Purchasing Manager, tôi muốn duyệt ticket của nhân viên trước khi gửi Legal.

- **AC1**: Given Purchasing Submit for approval và owner có Line Manager Then ticket vào Task Manager (`pending_manager`); Manager Start → Approve → `pending_legal`.
- **AC2**: Given Manager Reject Then ticket trả Purchasing (Task) kèm lý do/comment; có thể kèm file.
- **AC3**: Sprint 1: Approve / Reject **cơ bản** (comment). UI TH1/TH2/TH3 chi tiết → **VII**.
- **AC4**: Role `purchasing_manager`; Task cá nhân — chỉ thấy ticket cần mình xử lý.

## Epic 2 — Legal / Manager: Duyệt hợp đồng

### US-L01 — Màn Task (Purchasing / Manager / Legal) · Demo ✅ `/dashboard/tasks`
- **AC1**: Given đăng nhập Legal và có HĐ `pending_legal` Then Task hiển thị ticket chờ duyệt; bấm **Start** mở chi tiết.
- **AC2**: Given đăng nhập Purchasing Manager và có HĐ `pending_manager` Then Task hiển thị ticket chờ duyệt Manager.
- **AC3**: Given màn chi tiết (Manager/Legal) Then có tab Thông tin chung + AI Review / quyết định Approve·Reject.
- **AC4**: Given Purchasing có ticket bị reject **hoặc** `pending_markers` Then Task hiển thị ticket của chính user; Start mở workspace / **Gán chữ ký**.
- **AC5**: **Task cá nhân** — không thấy task người khác. Không có task → trạng thái trống rõ ràng.
- **AC6**: Task Name: dòng 1 = `Số tài liệu - Tên tài liệu`; dòng 2 = Họ tên người yêu cầu.

### US-L02 — Approve / Reject với Structured Feedback · Demo ✅
- **AC1**: Given bấm Từ chối mà chưa nhập comment Then bị chặn.
- **AC2** `[A4 đã chốt]`: Given reject kèm comment (+ file đính kèm nếu có) Then feedback lưu; Purchasing tải được (nếu có file).
- **AC3**: Given Manager Approve Then → `pending_legal`. Given Legal Approve Then resolve ma trận Phân quyền ký → `pending_markers` (+ Task người tạo) — **không** gọi FPT tại bước này.
- **AC4**: Sprint 1 chỉ Approve/Reject cơ bản. UI TH1/TH2/TH3 + PA-A/PA-B → **VII** (Blueprint giữ mô tả tham chiếu phase sau).

### US-L03 — Xem toàn bộ hợp đồng · Demo ✅
- **AC1**: Given đăng nhập Legal (hoặc IT/role có quyền list) Then thấy tất cả HĐ, kèm bộ lọc.
- **AC2**: Nút Quay lại từ Cấu hình HĐ / Configurations về danh sách HĐ (`/dashboard`).

### US-L04 — Comment 2 chiều theo field/đoạn · ❌ **Bỏ khỏi Sprint 1** (Blueprint VII)
- Thuộc nhóm UI TH1 / PA-A·PA-B — ngoài phạm vi Sprint 1.

### US-L05 — Track Changes (chỉ vùng mở, luôn kèm Reject) · ❌ **Bỏ khỏi Sprint 1** (Blueprint VII)
- Thuộc nhóm UI TH2 — ngoài phạm vi Sprint 1.

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

### US-C04 — Phân quyền ký eContract + Approval Matrix confidence · Demo ✅ / 🟡
- **AC1** ✅: Given Configurations → tab **Phân quyền ký** Then cấu hình bảng Công ty (multi) × Loại HĐ × min/max × Xem xét|Ký chính × User; Lưu; resolve → recipients eContract (`reviewer`/`signer`).
- **AC2** ✅: Given Legal approve (hoặc mở `/identify-signers`) Then resolve ma trận → prefill bên mua; người tạo chỉnh được; Legal approve chặn nếu không khớp dòng.
- **AC3** 🟡: Approval Matrix (ngưỡng ↔ Manager/Director/BOD) vẫn dùng **cảnh báo + % tin cậy** — không routing nội bộ thay Line Manager→Legal.

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
- **AC2**: Given sửa prompt CURRENT Then validate placeholder (`{{checklist_items}}`…) và chặn hardcode nội dung pháp lý trước khi lưu — ghi qua BE `GET/PUT /api/system-prompts` (file Git `/prompts`).
- **AC3**: Given thay đổi trên Git Then CI `validate-prompts` phải pass mới merge.

### US-I03 — Users & phân quyền hạng mục · Demo ✅ `/dashboard/users`
- **AC1**: Given IT When tạo/sửa user Then có Họ tên, username, role, Line Manager, tick quyền hạng mục (Task, Danh sách HĐ, Tạo tài liệu, Review hợp đồng, Cấu hình HĐ, Form lists, Phân quyền ký, System prompts, Users…).
- **AC2**: Given user thiếu quyền một hạng mục Then không vào được màn tương ứng.

## Epic 5 — Hệ thống: AI Engine & Tích hợp

### US-S01 — AI Review Engine · Demo 🟡 (mock heuristic; pipeline logic theo Blueprint 1.3.5)
- **AC1**: Given HĐ vào queue Then resolve checklist bằng `getMergedConfigForContractName(contractNameId)` (cha ∪ overlay) + System Prompt `checklist_review` → findings / đề xuất A/B.
- **AC2**: Given LLM lỗi/timeout Then fallback rule-based, đánh dấu rõ `[phụ thuộc B4]`.
- **AC3**: Given có findings Then stage `ai_summary_fairness` sinh summary + fairness; % tin cậy và Fairness Score tách biệt `[B2]`.

### US-S02 — Đồng bộ Econtract (outbound) · Demo 🟡 (`backend/` `POST /api/econtract/push`; cần credentials FPT) `[phụ thuộc D1a/D1b/D1e]`
- **AC1**: Given người tạo Submit trên design-markers (sau Legal + đủ marker) Then BE gọi login + excall FPT với `headerFields` + parties + file base64 (PDF ưu tiên); username/password FPT = user AI Legal đang đăng nhập `[D1c]`.
- **AC2** `[D1d]`: Kênh nhận file ký về (sFTP/callback inbound) **không thuộc scope xây dựng** AI Legal Sprint 1.

### US-S03 — Xuất `.docx` giữ format · Demo 🟡 `[phụ thuộc C4]`
- **AC1**: Given cần file mang marker / export When sinh OOXML Then `.docx` giữ format gốc, chỉ thay vùng mở / chèn marker theo allow-list (đủ cho đẩy eContract).

## Definition of Ready cho từng story

1. Mọi `[phụ thuộc]` đã có quyết định trong `02-open-questions.md` hoặc Blueprint đã chốt.
2. AC được TESTER xác nhận viết được test case.
3. Story cần API có endpoint tương ứng trong `04-api-contract.md` / `docs/api-contract.md`.
4. UI story có màn hình demo tham chiếu hoặc mockup được duyệt.
5. Story khớp Blueprint **v1.28** (phạm vi Sprint 1 + VII ngoài phạm vi).
