# AI Review Hợp đồng Mua hàng

> Nguồn yêu cầu: `Tom_tat_yeu_cau_AI_Review_Hop_dong_Rev12.docx`

Trợ lý AI nội bộ giúp **phòng Mua hàng** tự rà soát và hoàn thiện hợp đồng nháp (`.docx`) trước khi **Legal review & phê duyệt trong hệ thống**, rồi **đồng bộ sang Econtract** để trình ký.

> Kết quả AI chỉ là gợi ý — không thay thế rà soát pháp lý chính thức.

## Mục tiêu

- Đối chiếu điều khoản **bắt buộc / cấm / khuyến nghị** theo từng loại hợp đồng
- Đề xuất chỉnh sửa kèm **giải thích** và **% độ tin cậy AI** (+ **Fairness Score** riêng)
- **3 phương thức chỉnh sửa** song song: Chat AI (mặc định) · sửa trực tiếp inline trong hệ thống · tải xuống → sửa Word → upload lại
- Tôn trọng cấu trúc khoá Word (Restrict Editing / Range Permission / Content Control)
- Legal **approve / reject** (reject kèm Structured Feedback: Comment và/hoặc Track Changes trên vùng mở)
- Interface với **Econtract** (đẩy trình ký một chiều qua API + nhận file đã ký về qua **sFTP**/callback)

## Vai trò

| Vai trò | Quyền / trách nhiệm |
|---------|---------------------|
| **Purchasing** | Khởi tạo, AI review, chỉnh sửa, gán marker ký số, submit duyệt; chỉ thấy hợp đồng của mình |
| **Purchasing Manager** | Duyệt HĐ subordinate (TH1/TH2/TH3); Approve → Legal |
| **Legal** | Checklist + Approval Matrix (Sửa + Lưu); duyệt `pending_legal`; Approve → Econtract |
| **IT** | Triển khai LLM Local, app, tích hợp; Form lists / System Prompt; Users + tick phân quyền |
| **Econtract** | Hệ thống trình ký — API đồng bộ hai chiều |

## Phạm vi

- **2 nhóm HĐ:** Hợp đồng khung (bắt buộc khớp template chuẩn) và Hợp đồng NCC/khác (không bắt buộc khớp 100%)
- Loại chưa có checklist chi tiết: vẫn chọn được; AI review theo lớp ngữ nghĩa chung + cảnh báo *tham khảo*
- Kiến trúc: app mới; tích hợp **API một chiều** với Econtract; chiều nhận hợp đồng đã ký về qua **sFTP**
- Đầu ra: `.docx` hoàn thiện, **giữ format** giống file input
- Khối lượng: vài trăm HĐ/tháng → **Processing Queue**
- Model: **LLM Local** (không dùng cloud); fallback rule-based nếu LLM sự cố

## Workflow tổng quát

```
Purchasing input → Queue → AI handle → Purchasing gán marker ký số
  → Purchasing submit → Legal review & approve/reject
  → (reject: Structured Feedback → quay lại chỉnh sửa, version mới)
  → (approve: Interface Econtract → Callback cập nhật trạng thái ký)
```

## Số tài liệu (Document number)

Tự sinh khi tạo / lưu nháp — **user không sửa được** (field read-only, không ghi chú phụ trên UI).

- **Format:** `(Mã công ty).(Mã loại hợp đồng).NămYY + STT`  
  Ví dụ: `VTS.HQP.260001`
- **Mã công ty** = `businessEntities.code` (Form lists → Công ty)
- **Mã loại hợp đồng** = `documentCategories.code` (Form lists → Loại hợp đồng / Contract category, vd HQP, RAW, LOG)
- **STT** tăng theo **từng công ty** trong năm (không phụ thuộc loại HĐ)

### Thứ tự field form Tạo tài liệu (rút gọn)

1. Loại hợp đồng → 2. Tên hợp đồng → **3. Công ty** → 4. Tên tài liệu → 5. Số tài liệu (tự sinh) → 6. Ngày ký → 7. Loại giá trị HĐ → 8. Hợp đồng tiêu chuẩn → 9–11. Chiết khấu / giá trị → Upload

## Luồng người dùng

1. **Khởi tạo** — Chọn Loại HĐ + Công ty (trước Tên tài liệu), upload `.docx`; Số tài liệu tự sinh khi đủ Công ty + Loại hợp đồng  
   - HĐ khung: đối chiếu template → không khớp thì **chặn** (fail-fast)  
   - HĐ NCC/khác: quét vùng mở theo thứ tự **Range Permission** (`w:permStart`/`w:permEnd`) → Content Control → Legacy Form Field
2. **AI xử lý** — Processing Queue; đề xuất **Loại A** (vùng mở) / **Loại B** (vùng khoá)
3. **Màn hình 3 cột** — Chat | File gốc | File AI-reviewed (% tin cậy + diff kiểu compare)  
   - Loại A: undo/accept từng dòng hoặc cả file  
   - Loại B: chỉ cảnh báo/annotation (không ghi đè)  
   - Chat cập nhật diff realtime; badge % tin cậy mở popup phân tích  
   - Sửa trực tiếp inline trên Cột 3 (Phương thức 2 — chỉ vùng mở); panel comment 2 chiều  
   - **Lưu thủ công (Mục 4.3):** không autosave; cảnh báo khi thoát còn thay đổi chưa lưu (Lưu / Thoát không lưu / Huỷ); phải lưu xong mới submit được
4. **Gán marker ký số (bắt buộc trước Legal)** — UI kéo-thả/click sinh marker Econtract (`#ds:…#`, `#is:…#`, `#st:…#`); validate id/role/không trùng; thiếu marker → chặn submit
5. **Gửi Legal / Export** — Tải `.docx` hoặc gửi duyệt trong hệ thống  
   - Reject → Structured Feedback (Comment + Track Changes) → checklist việc cần sửa → Bước 3 accept/undo → chủ động resubmit (version mới)  
   - Approve → API Econtract → nhận file đã ký về (sFTP/callback) + cập nhật trạng thái

## Ba phương thức chỉnh sửa (Mục 4.7)

| | PT1 — Chat AI (**mặc định**) | PT2 — Sửa trực tiếp trong hệ thống | PT3 — Offline Word |
|--|------------------------------|-------------------------------------|--------------------|
| Cách làm | Gõ yêu cầu trong Chat; AI cập nhật diff | Bôi đen / gõ đè **inline** ngay trên Cột 3, không qua chat | Tải `.docx` → sửa Word local → **upload lại** |
| Khi nào | Đa số chỉnh sửa nội dung / số liệu | Biết chính xác vị trí & nội dung cần sửa, muốn thao tác nhanh | Cấu trúc lại nhiều điều khoản, chèn phụ lục… |
| Phạm vi | Vùng mở (chặn trước khi gọi LLM nếu ngoài allow-list) | **Chỉ vùng mở (Loại A)** theo allow-list | Cả file (nhưng vùng khoá được validate lại) |
| Version | Cập nhật trên phiên bản hiện tại | Cập nhật trên phiên bản hiện tại (re-validate realtime) | Coi là **vòng review mới** (bump version, chạy lại AI Engine) |
| Bảo vệ vùng khoá | Write-back Allow-list ở tầng code | Write-back Allow-list ở tầng code | Validate lại cấu trúc + so vùng khoá với template; template nên có mật khẩu Restrict Editing |

Cả 3 luôn khả dụng song song trong cùng phiên review (Bước 3), không ép thứ tự; mọi thay đổi ghi chung 1 audit trail có **gắn nhãn nguồn gốc** (chat / sửa trực tiếp / upload lại).

## Structured Feedback & Legal edit (Mục 4.5)

- **Comment (vùng mở + vùng khoá):** gắn theo field/đoạn (anchor kiểu `w:commentRangeStart/End`, không theo số dòng; đoạn bị xoá → comment "orphaned" vẫn hiển thị); **2 chiều** (Purchasing & Legal reply cùng thread, panel riêng); tự tổng hợp thành checklist việc cần sửa
- **Track Changes của Legal (chỉ vùng mở):** Legal tô đen → popup nhập nội dung mới (gián tiếp, khác Purchasing sửa inline) → hệ thống sinh diff đỏ/xanh **tách lớp** với diff AI; sửa luôn đi kèm **Reject** (không có sửa + approve)
- **Purchasing xử lý:** Accept (ghi giá trị Legal đề xuất) / Undo (revert bản đã submit, không cần lý do) từng dòng hoặc cả file; **không tự động resubmit** — phải bấm "Gửi Legal duyệt"
- **Version (Mục 4.5.4):** 1 bộ đếm chung tăng dần, không phân biệt actor (v1 submit → v2 Legal reject kèm sửa → v3 resubmit → …); mỗi version lưu người thao tác, hành động, diff cấp field, comment phát sinh

## Popup tin cậy & Fairness (ContractGuard-style)

Bấm badge **% tin cậy** → popup (không làm tối nền khi neo cạnh nút), gồm:

- **Độ tin cậy AI** — chắc chắn của phân tích (checklist + Approval Matrix + LLM)
- **Fairness Score** — mức cân bằng/có lợi của điều khoản cho Công ty (tách biệt; tính từ tỷ trọng Red Flag/Warning so với Protection)
- **4 nhóm phát hiện:** Red Flag · Warning · Protection · Missing Protection  
  (suy ra từ tổ hợp Loại × Mức độ nghiêm trọng của checklist — không cần field mới)
- AI tóm tắt điểm chính + field vừa đổi (cũ → mới)

## Cấu hình loại HĐ & Checklist

Mỗi loại HĐ do Legal định nghĩa: template mẫu + checklist cấu trúc + cờ “bắt buộc khớp template”.

Mỗi điều khoản checklist gồm (rút gọn): mã, tên, **Loại** (bắt buộc/cấm/khuyến nghị), **Mức độ** (Block / cảnh báo cao/thấp), **Ideal / Fallback / Red Line**, Rationale, keywords, điều kiện áp dụng, field liên kết (Range Permission/Content Control), cấp duyệt khi vượt Fallback.

- AI 2 tầng: **rule-based** (keywords) + **semantic** (LLM vs Ideal)
- Governance Sprint 1: Legal **Sửa + Lưu** trực tiếp trên UI (không Draft/Publish); audit trail cấu hình tách audit hợp đồng
- Approval Matrix: ngưỡng giá trị ↔ cấp duyệt — **Sprint 1 chỉ dùng để tính % tin cậy & cảnh báo**, không multi-level routing
- **Cần chốt (Mục 6.4):** Matrix riêng theo từng loại HĐ hay dùng chung — nếu riêng, cấu hình loại HĐ cần field liên kết matrix tương ứng
- Import/Export Excel: ngoài scope Sprint 1 (A10)

## System Prompt / Skill Layer (IT — tách khỏi Checklist Legal)

| Nguyên tắc | Chi tiết |
|------------|----------|
| Tách trách nhiệm | Checklist = nội dung pháp lý (Legal); System Prompt = hành vi AI (IT) |
| MVP | Quản lý bằng **file trong Git** (không UI Publish); IT xem/sửa CURRENT qua app tại `/dashboard/configurations` (validate + CI chặn lỗi) |
| Stages | `checklist_review` · `chat_edit` · `ai_summary_fairness` · `field_validation` |
| Cấu trúc | `/prompts/<stage>/v*.md` + `current.json` (hoặc `CURRENT`); shared `/prompts/_shared/injection_guard.md` |
| Bắt buộc | Chỉ hành vi + placeholder (`{{checklist_items}}`…); **không hardcode** điều khoản |
| Prompt injection | Không tuân theo chỉ dẫn trong nội dung HĐ / chat của user; phát hiện → Red Flag |

## Write-back Allow-list (bảo vệ vùng khoá)

- **Lớp 1 (bắt buộc):** hàm ghi file chỉ chấp nhận field ID trong allow-list vùng mở xác định **trước** khi gọi AI; diff ngoài allow-list bị bỏ qua
- **Lớp 2 (UX):** prompt hướng AI tập trung vùng mở — không thay thế Lớp 1
- Chat: nếu vị trí yêu cầu nằm ngoài allow-list → từ chối trước khi gọi LLM sinh diff

## Tính năng bắt buộc (Sprint 1)

| Nhóm | Nội dung |
|------|----------|
| Cấu hình loại HĐ | Template + checklist cấu trúc + cờ khớp template; versioning; import/export; audit config |
| Approval Matrix | Ngưỡng ↔ cấp duyệt; chỉ % tin cậy & cảnh báo |
| Input + Queue | Upload `.docx`, kiểm tra cấu trúc, prompt; hàng đợi LLM Local |
| AI Review Engine | Checklist + ngữ nghĩa; đề xuất A/B; 4 nhóm + Fairness |
| UI 3 cột + Chat | Diff; Accept/Undo Loại A; Loại B annotation; panel comment 2 chiều |
| Field-level Editing | Ghi đè đúng vùng mở (Range Permission / CC / Form Field); PT2 sửa inline trên Cột 3 |
| Save thủ công | Không autosave; cảnh báo thoát chưa lưu; bắt buộc lưu trước submit |
| Phương thức 3 | Download → sửa offline → reupload = new review cycle + validate khoá |
| Marker ký số | Gán & validate trước Legal |
| Re-validate + Popup | % tin cậy realtime; Fairness; tóm tắt AI |
| Legal Review | Approve/reject + Structured Feedback (Comment + Track Changes popup vùng mở, luôn kèm Reject) |
| Econtract | Đồng bộ HĐ đã duyệt (API một chiều) + nhận file đã ký về qua sFTP/callback |
| Audit / Version / RBAC | Audit AI/field/Legal gắn nhãn nguồn; version counter chung tuần tự; Purchasing vs Legal |
| System Prompt (Git) | 4 stage + injection guard |
| Export + Disclaimer | `.docx` giữ format; disclaimer trên UI |

### Phase sau

Risk scoring theo điều khoản · so sánh HĐ tương tự · UI admin nâng cao · multi-level approval routing. (UI sửa System Prompt cho IT đã có sẵn trong demo tại `/dashboard/configurations`.)

## Kiến trúc (định hướng)

| Lớp | Vai trò |
|-----|---------|
| Config | ContractType + Approval Matrix (Sửa + Lưu trên UI) |
| System Prompt | File Git theo stage; ghép injection_guard lúc load |
| Queue | Hàng đợi Local LLM, trạng thái realtime |
| Document Pipeline | Parse `.docx` → (HĐ khung) so khớp template → checklist → LLM → A/B → render |
| Field Extraction | Range Permission → Content Control → Form Field → form UI → ghi XML đúng field |
| Write-back Allow-list | Chỉ ghi vùng mở; Loại B không có đường ghi đè |
| Diff & Chat | Diff word-level; chat giữ ngữ cảnh; chặn sửa vùng khoá trước khi gọi LLM |
| Validation | Rule-based + Matrix → 4 nhóm + Fairness + % tin cậy |
| Legal Feedback | Comment anchor theo field (2 chiều, orphaned-safe) + Track Changes popup → checklist việc cần sửa |
| Callback/Webhook | Nhận file đã ký từ Econtract (sFTP/callback), cập nhật trạng thái + lưu file |

## Rủi ro chính

AI bỏ sót / sai · checklist & ma trận lỗi thời · bảo mật dữ liệu trên LLM Local · template sai cấu trúc khoá · lệch style khi ghi XML · HĐ NCC không có vùng mở (chỉ Chat) · nghẽn queue cuối tháng/quý · callback Econtract treo (cần retry/đối soát) · marker sai/thiếu · **Phương thức 3:** user gỡ Restrict Editing / mất `permStart` khi sửa Word (cần mật khẩu template + chạy lại toàn bộ AI Engine + so vùng khoá với bản gốc khi upload).

## Lộ trình gần

| Mốc | Nội dung |
|-----|----------|
| Sprint 1 | Tháng 9 test · tháng 10 Pilot — HĐ khung + NCC (nhóm Mua hàng chung) |
| Tiếp theo | Mockup · họp chị Vũ · chốt Sprint 1 · gom & phân loại tài liệu đã ký trên Econtract · Technical Solution (Queue, Callback, Structured Feedback) · tài liệu dự án |
| Sprint 2 | Các loại tài liệu còn lại |

## Frontend (demo)

Stack: **Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui (Radix)** · mock BE (`localStorage`).

### Chạy local

```bash
cd frontend
cp .env.example .env.local   # mặc định NEXT_PUBLIC_USE_MOCK=true
npm install
npm run dev                  # http://localhost:3001
```

Demo: [http://localhost:3001/dashboard/contracts/rev_demo_draft_hddv](http://localhost:3001/dashboard/contracts/rev_demo_draft_hddv)

### Màn hình đã có

| Route | Mô tả |
|-------|--------|
| `/login` | Purchasing / Legal / Legal Lead / **IT** |
| `/dashboard` | Danh sách hợp đồng |
| `/dashboard/contracts/new` | Tạo review: form thông tin + upload **1 file** `.docx` + prompt |
| `/dashboard/contracts/[id]` | Queue → workspace Chat + preview Word (diff Accept/Undo) → marker → gửi Legal |
| `/dashboard/legal` | Legal approve/reject + Structured Feedback |
| `/dashboard/config` | Cấu hình loại HĐ (versioning, matrix, AI 2 tầng) |
| `/dashboard/config/[id]` | Checklist clause · preview · import/export · audit |
| `/dashboard/configurations` | IT: Form lists (dropdown tạo HĐ) + System prompts |

Mock: `NEXT_PUBLIC_USE_MOCK=true`. Khi có BE: `NEXT_PUBLIC_USE_MOCK=false` + `NEXT_PUBLIC_API_URL`.

### Tài liệu yêu cầu trong repo

| File | Mục đích |
|------|----------|
| [frontend/public/samples/Tom_tat_yeu_cau_AI_Review_Hop_dong_Rev12.docx](frontend/public/samples/Tom_tat_yeu_cau_AI_Review_Hop_dong_Rev12.docx) | Tóm tắt yêu cầu **Rev12** (nguồn README này) |
| [frontend/public/samples/Tom_tat_yeu_cau_AI_Review_Hop_dong_Rev10.docx](frontend/public/samples/Tom_tat_yeu_cau_AI_Review_Hop_dong_Rev10.docx) | Bản Rev10 cũ (tham chiếu lịch sử) |
| [prompts/](prompts/) | System Prompt theo stage + con trỏ `current.json` |
| [docs/requirements-alignment/](docs/requirements-alignment/) | Bộ tài liệu giai đoạn thống nhất yêu cầu — bắt đầu từ `00-pm-roadmap.md` (lộ trình 10 ngày cho PM), kèm gap analysis · open questions · user stories · API contract · NFR/risks · test strategy |
