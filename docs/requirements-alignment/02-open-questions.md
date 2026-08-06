# 02 — Open Questions: Danh sách câu hỏi cần chốt với Stakeholder

> Owner: BA (tổng hợp) · Trả lời trong Workshop 1 (Legal/Purchasing) và Workshop 2 (IT/Kiến trúc)
> Quy ước: mỗi câu hỏi phải kết thúc bằng **Quyết định** + người chốt + ngày. Câu chưa chốt được thì ghi rõ "Hoãn có chủ đích" kèm lý do.

## A. Nghiệp vụ (Workshop 1 — Legal, Purchasing, PM, BA)

> Cập nhật 04/08/2026 — PM đã chốt cột Quyết định (theo bảng PM gửi). Các dòng đánh dấu ⚠ có phần cuối bị cắt trong ảnh chụp — BA xác nhận lại nguyên văn với PM rồi xoá cảnh báo.

| ID | Câu hỏi | Bối cảnh từ demo/README | Quyết định |
|----|---------|--------------------------|------------|
| A1 | Vòng reject lặp bao nhiêu lần? Mỗi lần reject có bump version và bắt buộc chạy lại AI review không? | Demo: reject → feedback → Purchasing sửa → version mới. README chỉ mô tả 1 vòng | ✔ AI chỉ review lại và đánh giá sau khi Purchasing sửa ⚠ *(phần cuối bị cắt — cần PM bổ sung: có giới hạn số vòng và bump version không?)* — PM 04/08/2026 |
| A2 | Sau khi submit Legal, Purchasing còn được sửa intake/tài liệu không? Legal có được sửa gì không hay chỉ approve/reject? | Demo: `canEdit` loại trừ `pending_legal`; Legal hoàn toàn read-only | ✔ Sau khi Legal approve thì ticket review sẽ được đóng ⚠ *(phần cuối bị cắt — hiểu là trước khi approve Purchasing vẫn sửa được? Cần xác nhận)* — PM 04/08/2026 |
| A3 | Legal duyệt 1 bước (single-step) đúng cho Sprint 1? Approval Matrix chỉ dùng để cảnh báo + tính % tin cậy, không routing nhiều cấp? | README từng mô tả single-step; demo chưa có bước Manager | ✔ **Đã chốt trong luồng nghiệp vụ tổng thể (Blueprint Hình 2)**: Purchasing → AI → Purchasing Review & Adjust → **Purchasing Manager approve** → **Legal review** → Econtract. Reject ở Manager hoặc Legal đều quay về Review & Adjust. Approval Matrix: vẫn chờ chốt vai trò cảnh báo vs routing — PM 05/08/2026 |
| A4 | Structured Feedback theo Rev12 (comment 2 chiều theo field/đoạn + Track Changes của Legal): scope Sprint 1 làm đủ cả 2 hay tách pha? File đính kèm feedback có bắt buộc lưu và Purchasing tải được không? | Rev12 Mục 4.5 yêu cầu đầy đủ; demo mới có 1 comment tổng + attachment chỉ lưu tên file (gap 11b/11c) | ✔ File đính kèm feedback: bắt buộc lưu, **Purchasing được tải** — PM 04/08/2026. Scope comment 2 chiều vs tách pha: chưa nêu rõ, xử lý tiếp ở A4b/A4c |
| A4b | Track Changes của Legal: xác nhận quy tắc "sửa luôn đi kèm Reject, không có sửa + approve" và Purchasing Accept/Undo từng dòng không cần lý do? | Rev12 Mục 4.5 đã mô tả — cần Legal xác nhận vận hành thực tế | ✔ **Đúng** — xác nhận quy tắc như Rev12 mô tả — PM 04/08/2026 |
| A4c | Lưu thủ công (Mục 4.3): phạm vi áp dụng (chỉ PT2 inline hay mọi chỉnh sửa)? Hành vi 3 nút Lưu / Thoát không lưu / Huỷ khi rời trang? | Demo đang autosave mỗi thao tác — ngược yêu cầu | ✔ Áp dụng cho **mọi chỉnh sửa**; hỏi xác nhận trước khi lưu thay đổi ⚠ *(phần cuối bị cắt)* → demo phải bỏ autosave — PM 04/08/2026 |
| A5 | "Purchasing chỉ thấy HĐ của mình" — theo user hay theo phòng ban/nhóm? Có role xem chéo không? | Code hiện là no-op (mọi Purchasing thấy hết) | ✔ **User chỉ thấy ticket của chính mình** ⚠ *(phần sau về Purchasing bị cắt — cần xác nhận có role xem chéo/manager không, liên quan A3)* — PM 04/08/2026 |
| A6 | HĐ khung không khớp template: chặn ngay lúc upload (fail-fast) hay cho vào queue rồi báo lỗi? Tiêu chí "khớp" là gì (cấu trúc vùng khoá? hash? % giống)? | Demo chưa có bước này lúc tạo | ✔ **Chặn ngay lúc upload (fail-fast)** — PM 04/08/2026. Tiêu chí "khớp" (PM yêu cầu team đề xuất): **so khớp cấu trúc vùng khoá** — số lượng + id/tag của Content Control & Range Permission phải trùng template gốc, kèm **hash nội dung vùng khoá**; không dùng % giống toàn văn bản (dễ false positive khi vùng mở thay đổi hợp lệ). Legal xác nhận trong Workshop 1 |
| A7 | Marker ký số: click chọn vị trí có đủ cho Sprint 1 không, hay bắt buộc kéo-thả trên preview? Danh sách role ký (`ds`/`is`/`st`) đã đủ chưa? | README nói "kéo-thả/click"; demo chỉ click | ✔ **Bắt buộc kéo-thả trên preview**; danh sách marker `ds`/`is`/`st` ⚠ *(phần cuối bị cắt — hiểu là danh sách đã đủ)* → trả lời luôn D1f: cần toạ độ trên preview, demo phải nâng cấp từ click-chọn — PM 04/08/2026 |
| A8 | SLA xử lý 1 HĐ trong queue (phút/giờ?) và hành vi khi nghẽn cuối tháng/quý (ưu tiên theo gì?) | README chỉ nói "vài trăm HĐ/tháng" | ✔ Xử lý **theo hàng chờ FIFO (first-in-first-out)**, không ưu tiên đặc biệt — PM 04/08/2026. SLA con số cụ thể: chưa chốt, gắn với NFR-P (05-nfr-and-risks.md) |
| A9 | Loại HĐ chưa có checklist: hiển thị cảnh báo "tham khảo" ở đâu, ai chịu trách nhiệm khi AI sai? Disclaimer pháp lý cần Legal duyệt câu chữ | Demo đã có cảnh báo + disclaimer, cần Legal chốt wording | ✔ PM giao team đề xuất — **Đề xuất**: (1) banner cảnh báo cố định trên màn kết quả AI khi HĐ không có checklist khớp; (2) dòng disclaimer in kèm trong file feedback xuất ra; (3) wording đề xuất: *"Kết quả do AI tạo và chỉ mang tính tham khảo. Quyết định phê duyệt cuối cùng thuộc về người phê duyệt (Legal)."* — trách nhiệm khi AI sai thuộc người phê duyệt cuối. Legal duyệt câu chữ trong Workshop 1 |
| A10 | Import/Export checklist: CSV có chấp nhận được không (mở được bằng Excel) hay bắt buộc `.xlsx`? Template file trao đổi giữa Legal ↔ hệ thống? | Service demo là CSV | ✔ **Bỏ Import/Export checklist** (khỏi scope Sprint 1); template file sẽ được… ⚠ *(phần cuối bị cắt — cần PM bổ sung câu đầy đủ)* → cập nhật user story US liên quan checklist import/export sang backlog — PM 04/08/2026 |

## B. AI / LLM (Workshop 2 — IT, DEV, kèm Legal cho tiêu chí chất lượng)

| ID | Câu hỏi | Bối cảnh | Quyết định |
|----|---------|----------|------------|
| B1 | Chọn LLM local nào (model, size, license)? Hạ tầng GPU hiện có đáp ứng không? | README: "LLM Local, không dùng cloud" | _(chờ)_ |
| B2 | Công thức % tin cậy và Fairness Score **thật** thay heuristic demo: input gồm gì (checklist match, matrix, LLM logprob?), ai duyệt công thức? | Demo: công thức tuyến tính hardcode trong `contract-insight.ts` | _(chờ)_ |
| B3 | Tiêu chí nghiệm thu đầu ra AI: precision/recall tối thiểu trên bộ HĐ mẫu? Ai chuẩn bị bộ HĐ gán nhãn (golden set)? | Chưa có gì | _(chờ)_ |
| B4 | Fallback rule-based khi LLM lỗi: phạm vi (chỉ keywords checklist?) và cách báo cho user biết kết quả là fallback? | README yêu cầu, code chưa có | _(chờ)_ |
| B5 | 4 stage prompt đã đúng chưa (`checklist_review`, `chat_edit`, `ai_summary_fairness`, `field_validation`)? Output JSON schema từng stage do ai own? | Prompts đã viết nhưng chưa nối vào pipeline | _(chờ)_ |
| B6 | Prompt injection: quy trình khi phát hiện (Red Flag + tiếp tục review như prompt hiện tại, hay dừng hẳn)? | `injection_guard.md` hiện chọn "Red Flag và tiếp tục" | _(chờ)_ |
| B7 | Quyền sửa System Prompt: giữ như demo (IT sửa qua UI, có validate + CI) hay read-only theo README, chỉ sửa qua Git PR? | Mâu thuẫn M2 trong gap analysis | _(chờ)_ |

## C. Tài liệu Word / OOXML (Workshop 2, có Legal tham gia phần template)

> Cập nhật 04/08/2026 — PM đã chốt C1, C2, C3, C5 (theo bảng PM gửi). C4, C6 vẫn chờ Workshop 2.

| ID | Câu hỏi | Bối cảnh | Quyết định |
|----|---------|----------|------------|
| C1 | Template chuẩn có đặt mật khẩu Restrict Editing không? Ai giữ mật khẩu, quy trình đổi? | README khuyến nghị có | ✔ Có; **Legal** giữ mật khẩu — PM 04/08/2026. Quy trình đổi mật khẩu: Legal xác nhận chi tiết trong Workshop 2 |
| C2 | Thứ tự ưu tiên vùng mở: Range Permission → Content Control → Legacy Form Field — xác nhận đúng với template thực tế của công ty? | Code đọc theo đúng thứ tự này | ✔ **OK** — xác nhận đúng thứ tự này — PM 04/08/2026 |
| C3 | HĐ NCC không có vùng mở nào: chỉ cho phép chat + annotation (không ghi file)? UX thông báo thế nào? | README nêu rủi ro này, demo chưa xử lý riêng | ✔ **AI phản hồi rõ file không có vùng mở** (chat + annotation, không ghi file); nếu file **có** vùng mở thì chỉnh sửa như bình thường — PM 04/08/2026 |
| C4 | Ghi XML giữ format: mức chấp nhận lệch style? Cần thư viện/side-by-side test nào để nghiệm thu "giữ format giống input"? | Chưa có pipeline ghi OOXML | _(chờ — Workshop 2)_ |
| C5 | Reupload (PT3): khi validate phát hiện vùng khoá bị sửa/mất `permStart` → chặn hoàn toàn hay cho phép override có phê duyệt? | Logic validate đã có, chính sách chưa chốt | ✔ **AI không được sửa vùng khoá** → chặn hoàn toàn, không có cơ chế override — PM 04/08/2026. Demo đã validate đúng hướng này |
| C6 | PT2 sửa inline trên Cột 3: cơ chế re-validate realtime chạy ở đâu (client hay gọi API), tần suất? Diff PT2 có tách lớp với diff AI như Track Changes của Legal không? | Rev12 yêu cầu; demo có handler nhưng chưa bật editable | _(chờ — Workshop 2)_ |

## D. Tích hợp & Hạ tầng (Workshop 2 — IT, DEV, PM)

> Cập nhật 04/08/2026 — PM đã chốt D1c, D1d, D3, D4, D7 (theo bảng PM gửi). D1a/D1b/D1e chờ FPT; D1f (phần backend), D2, D5, D6 chờ Workshop 2.

| ID | Câu hỏi | Bối cảnh | Quyết định |
|----|---------|----------|------------|
| D1 | ~~Spec tích hợp Econtract~~ → **Đã có tài liệu chính thức FPT.eContract** (xem `07-econtract-integration.md`): 4 API + 3 callback + bảng mã lỗi + cú pháp marker `#ds:id r:p_001_r_001 h:100 #`. FE demo đã code theo spec. Còn lại các câu chi tiết D1a–D1f bên dưới | `docs/Tài _liệu_API.pdf` + `docs/Hướng-dẫn-cấu_trúc-đánh-dấu-marker.docx` | ✔ Một phần |
| D1a | Giá trị `selector` chính thức FPT cấp cho hệ thống mình (placeholder hiện tại: `flow_start_AI_LEGAL_..._integrate`)? | Selector sai → lỗi code 13 "Selectors are not the same" | _(chờ FPT)_ |
| D1b | Danh sách `docTypeCode` + headerFields cấu hình trên portal FPT.eContract — ai own việc cấu hình? | Lỗi `docTypeCodeIsNotExists` nếu sai | _(chờ FPT)_ |
| D1c | FPT nhận `.docx` trực tiếp hay phải convert **PDF** trước khi gửi? (tiêu đề API nói PDF, ví dụ request lại là .docx) | Ảnh hưởng pipeline giữ format (C4) | ✔ **Convert base64** khi gửi file lên API (đúng theo ví dụ request FPT) — PM 04/08/2026. Định dạng nguồn (.docx vs PDF) trước khi encode: vẫn xác nhận thêm với FPT khi có credentials |
| D1d | Callback: URL/auth/retry mình phải cung cấp? Có kênh **sFTP** nhận file ký như Rev12 mô tả không hay chỉ callback? | Rev12 nói sFTP; tài liệu API chỉ nói callback | ✔ **Kênh nhận file ký đã có sẵn (hệ thống hiện hữu), không cần làm trong AI Legal** — AI Legal chỉ cần gửi HĐ đi ký, không xây phần nhận file ký về — PM 04/08/2026 |
| D1e | Xin credentials môi trường Demo (`clientid/clientsecret` + account) để chạy integration test EC-07..09 | Cần trước khi Sprint 1 code BE | _(chờ FPT)_ |
| D1f | UI gán vị trí marker Sprint 1: danh sách vị trí định sẵn (như demo) hay click-chọn-toạ-độ trên preview? | Quyết định cách backend chèn marker mực trắng vào đúng vị trí | ✔ Phần UI đã chốt ở **A7**: bắt buộc kéo-thả trên preview — PM 04/08/2026. Phần backend chèn marker mực trắng theo toạ độ: _(chờ — Workshop 2)_ |
| D2 | Auth: SSO nội bộ (AD/LDAP/OAuth?) hay tài khoản riêng? Mapping 4 role từ hệ thống nào? | FE đã có quản lý Users (IT) + login username/password + đổi MK; bỏ login nhanh theo role. Mapping role: purchasing / purchasing_manager / legal / legal_lead / it. Bản chính thức chờ chốt SSO vs tài khoản riêng | _(chờ)_ |
| D3 | Lưu file `.docx` các version ở đâu (NAS/S3-compatible/DB)? Chính sách retention và bảo mật (HĐ là dữ liệu nhạy cảm) | Demo dùng localStorage + sample URL | ✔ Lưu trong **DB** — PM 04/08/2026. Retention/bảo mật chi tiết: chốt ở Workshop 2 |
| D4 | Backend stack chốt là gì (README ám chỉ API tại `:8000`)? Team DEV backend là ai? | FE đã viết sẵn client cho REST `/api/*` | ✔ **Team DEV backend nội bộ, cùng team** — PM 04/08/2026. Stack cụ thể: chốt ở Workshop 2 |
| D5 | Hạ tầng queue: Redis/RabbitMQ/DB-based? Cần trạng thái realtime trên UI (polling như demo hay WebSocket)? | Demo polling `advanceQueue` | _(chờ)_ |
| D6 | Môi trường: DEV/UAT/PROD, quy trình deploy, và mốc tháng 9 test / tháng 10 pilot có còn khả thi sau giai đoạn này? | README lộ trình | _(chờ)_ |
| D7 | Audit log yêu cầu lưu những sự kiện nào, thời hạn lưu, ai được xem? | Demo có audit config + version history HĐ | ✔ Audit log lưu **thời gian và giá trị cũ → mới** của mỗi thay đổi — PM 04/08/2026. Thời hạn lưu + quyền xem: chốt ở Workshop 2 |

## Quy trình chốt

1. BA gửi tài liệu này trước workshop ≥ 2 ngày cho người tham dự.
2. Trong workshop: demo walkthrough màn hình liên quan trước khi hỏi (dùng demo làm prototype).
3. Sau workshop 24h: BA cập nhật cột Quyết định, PM xác nhận, lưu vào Git (PR để có trace).
4. Câu nào đổi scope Sprint 1 → PM đưa vào mục thay đổi scope trong sign-off.
