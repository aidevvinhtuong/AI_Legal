# CLAUDE.md — Ngữ cảnh & Yêu cầu sinh Technical Solution
## Dự án: AI Legal — Hệ thống AI Review Hợp đồng (Saint-Gobain Việt Nam)

> File này là **bản tóm tắt ngữ cảnh đầy đủ** để bạn (Claude) sinh ra tài liệu **Technical Solution**.
> Người yêu cầu là **Backend + AI engineer** của dự án. FE đã có bản mock-up; BA đã có Blueprint nghiệp vụ.
> **Trọng tâm: Backend và AI.** Frontend chỉ cần mức đủ để chốt hợp đồng tích hợp và quyết định editor Word.

---

## 0. NHIỆM VỤ CỦA BẠN

Sinh ra bộ tài liệu **Technical Solution** cho Phase 1, đủ chi tiết để team dev bắt tay code ngay.

### Nguyên tắc khi làm việc

1. **Phản biện, đừng chỉ vâng lời.** Tài liệu này có sẵn các đề xuất kỹ thuật (mục 6–9). Bạn phải đánh giá lại: đồng ý thì nói rõ lý do, không đồng ý thì đề xuất phương án tốt hơn kèm trade-off. Đặc biệt phản biện mục 8 (Word engine) và mục 7.4 (công thức scoring).
2. **Bám ràng buộc cứng ở mục 4.** Vi phạm ràng buộc cứng = giải pháp bị loại.
3. **Không né quyết định.** Với mỗi ngã ba, chọn 1 phương án làm khuyến nghị chính, nêu 1–2 phương án thay thế + điều kiện để đổi ý. Không viết kiểu "tùy team quyết".
4. **Ghi rõ giả định.** Mục 12 liệt kê câu hỏi chưa có đáp án. Với mỗi câu, hãy đưa ra giả định làm việc (working assumption) và ghi rõ phần thiết kế nào sẽ phải sửa nếu giả định sai.
5. **Cụ thể hoá đến mức code được.** Cần schema DB thật (DDL), OpenAPI thật, JSON schema thật, tên module thật, pseudo-code cho các thuật toán quan trọng — không nói chung chung.
6. **Tiếng Việt** cho phần diễn giải, giữ nguyên thuật ngữ kỹ thuật tiếng Anh.

### Cấu trúc output mong muốn

Sinh thành các file markdown riêng biệt (nêu rõ tên file), tối thiểu:

| File | Nội dung |
|------|----------|
| `TS-00-executive-summary.md` | Tóm tắt kiến trúc, các quyết định lớn, rủi ro top 5, timeline & effort estimate theo module |
| `TS-01-architecture.md` | Sơ đồ C4 (context / container / component) dạng mermaid, danh sách service, luồng dữ liệu, deployment topology (DEV/UAT/PROD), hạ tầng GPU |
| `TS-02-data-model.md` | ERD mermaid + DDL PostgreSQL đầy đủ, chiến lược versioning, audit append-only, retention |
| `TS-03-api-spec.md` | OpenAPI 3.1 đầy đủ cho toàn bộ endpoint (kể cả nhóm config hiện chưa có), state machine, mã lỗi chuẩn hoá |
| `TS-04-docx-engine.md` | **Quan trọng nhất.** Quyết định Word engine, thiết kế lớp đọc/ghi OOXML, allow-list, anchor model, comment/track-changes model, chèn marker, tiêu chí nghiệm thu giữ format, kế hoạch PoC |
| `TS-05-ai-pipeline.md` | **Quan trọng nhất.** Kiến trúc AI, chọn model, pipeline từng stage, JSON schema output, công thức scoring, fallback, chống injection, chiến lược eval + golden set |
| `TS-06-queue-and-jobs.md` | Hạ tầng queue, job model, idempotency, retry, backpressure, realtime status |
| `TS-07-econtract-integration.md` | Thiết kế outbound eContract, outbox pattern, reconciliation, mapping lỗi |
| `TS-08-security-rbac-audit.md` | AuthN/AuthZ, RBAC server-side, mã hoá at-rest, quản lý secret, audit trail, threat model |
| `TS-09-frontend-integration.md` | Điều chỉnh FE, tích hợp editor, contract FE↔BE, realtime |
| `TS-10-testing-and-acceptance.md` | Test strategy, golden set, tiêu chí nghiệm thu AI (precision/recall), format fidelity test, EC-01..09 |
| `TS-11-open-questions.md` | Câu hỏi còn treo + giả định đang dùng + tác động nếu sai |

Nếu bạn thấy cần thêm/gộp file, cứ làm — nhưng giải thích lý do.

---

## 1. BỐI CẢNH NGHIỆP VỤ

Hệ thống nội bộ giúp **phòng Mua hàng (Purchasing)** tự rà soát hợp đồng `.docx` bằng AI trước khi trình **Purchasing Manager** và **Legal** phê duyệt, rồi đẩy sang **FPT.eContract** để trình ký.

### Vai trò

| Role | Quyền chính |
|------|-------------|
| `purchasing` | Tạo tài liệu, chạy AI review, chỉnh sửa vùng mở, gán marker ký số, submit duyệt. **Chỉ thấy hợp đồng của chính mình** |
| `purchasing_manager` | Duyệt HĐ của cấp dưới (theo Line Manager). Approve → chuyển Legal |
| `legal` | Duyệt HĐ. Approve → đẩy eContract. Soạn/sửa/lưu checklist pháp lý theo loại HĐ |
| `it` | Quản lý Users + phân quyền, Form lists, System Prompt |

Vai trò `legal_lead` **đã bị bỏ** (Blueprint v1.8) nhưng vẫn còn sót trong type của FE — cần dọn.

### Luồng chính

```
Purchasing tạo tài liệu + upload .docx
  → FIFO Queue → AI Review Engine
  → Purchasing Review & Adjust (3 phương thức chỉnh sửa)
  → Gán marker ký số (bắt buộc, validate trước khi submit)
  → Submit
      ├─ owner có Line Manager → pending_manager → Manager duyệt
      │                            ├─ Approve → pending_legal
      │                            └─ TH1/TH2/TH3 → Từ chối → về Purchasing
      └─ không có Line Manager  → pending_legal
  → Legal duyệt
      ├─ Approve → đẩy FPT.eContract (outbound)
      └─ TH1/TH2/TH3 → Từ chối → về Purchasing (version mới)
```

**Quy tắc cứng:** không có "sửa/comment yêu cầu chỉnh + Approve". Mọi yêu cầu chỉnh sửa đều **bắt buộc kết thúc bằng Từ chối** (quyết định A4b).

### Ba phương thức chỉnh sửa của Purchasing

| | PT1 — Chat AI (mặc định) | PT2 — Sửa inline trong hệ thống | PT3 — Offline Word |
|--|--|--|--|
| Cách làm | Gõ yêu cầu, AI sinh diff | Sửa trực tiếp trên preview | Tải `.docx` → sửa Word → upload lại |
| Phạm vi | Chỉ vùng mở; ngoài allow-list → **từ chối trước khi gọi LLM** | Chỉ vùng mở (Loại A) | Cả file, nhưng vùng khoá bị validate lại |
| Version | Cập nhật version hiện tại | Cập nhật version hiện tại | **Vòng review mới** (bump version, chạy lại toàn bộ AI Engine) |

### Ba trường hợp xử lý của Manager/Legal khi không Approve

| TH | Hành động | Lưu trữ |
|----|-----------|---------|
| TH1 | Comment theo đoạn/field trên preview, thread 2 chiều | PA-A (snapshot version) và/hoặc PA-B (ghi `w:comment` vào .docx) |
| TH2 | Track Changes trên vùng mở (tô chọn → nhập nội dung đề xuất), diff **tách lớp** với diff AI | như trên |
| TH3 | Tải file → sửa offline bằng Word → upload lại + Từ chối → Purchasing làm lại từ đầu | file đính kèm phải lưu nội dung thật, Purchasing tải được |

---

## 2. PHÂN KỲ — ĐIỂM QUAN TRỌNG NHẤT CỦA TECHNICAL SOLUTION

Blueprint gộp cả hai nhóm hợp đồng vào Sprint 1. **Chủ dự án đã quyết định phân kỳ lại như sau, và Technical Solution phải bám theo:**

### Phase 1 — Hợp đồng khung (framework contract) — LÀM TRƯỚC

- Hợp đồng **standard, đã có mẫu (template) do Legal ban hành**.
- File `.docx` được **khoá cấu trúc**: chỉ một số vùng do Legal đánh dấu là **mở** (được sửa); **toàn bộ phần còn lại tuyệt đối không được chỉnh sửa**.
- Cơ chế vùng mở, theo thứ tự ưu tiên đã chốt (C2): `w:permStart`/`w:permEnd` (Range Permission) → Content Control (`w:sdt`) → Legacy Form Field.
- Template có mật khẩu Restrict Editing, **Legal giữ mật khẩu** (C1).

**Hệ quả kiến trúc cực lớn — bạn phải khai thác triệt để:**

> Phase 1 **không phải bài toán "AI viết lại hợp đồng"**. Nó là bài toán **"AI điền và thẩm định một tập hữu hạn các trường mở, trên một tài liệu có cấu trúc đã biết trước"**.

Điều này cho phép:

- **Ghi OOXML an toàn tuyệt đối:** writer chỉ nhận `(field_id, new_value)` và chỉ thay text trong đúng node của field đó. Không bao giờ có thao tác "ghi đè toàn văn bản". Rủi ro vỡ format (R3 — mức Cao) giảm xuống gần bằng 0.
- **Diff/version cấp field:** diff là `{field_id, old, new}`, không cần diff văn bản tự do.
- **Bài toán AI thu hẹp:** thay vì "đọc 40 trang rồi tự tìm điều khoản", AI làm việc trên **cặp (checklist clause ↔ vùng văn bản đã được neo sẵn)**. Precision/recall tăng mạnh, chi phí token giảm mạnh.
- **Loại B (vùng khoá) trong Phase 1 hầu như chỉ để annotation/cảnh báo** — vì template chuẩn thì vùng khoá đã đúng theo Legal. Loại B chủ yếu để phát hiện template bị can thiệp.

Technical Solution **phải thiết kế Phase 1 theo hướng structured-field**, và chỉ tổng quát hoá ở Phase 2.

### Phase 2 — Hợp đồng nhà cung cấp (NCC / vendor) — LÀM SAU

- File `.docx` tuỳ ý từ nhà cung cấp, **không bắt buộc khớp template**, có thể **không có vùng mở nào**.
- Khi không có vùng mở: chỉ chat + annotation, **không ghi file** (quyết định C3).
- Đây mới là bài toán redlining tự do: cần track changes cấp đoạn, semantic clause extraction trên văn bản không cấu trúc.

**Yêu cầu với bạn:** thiết kế kiến trúc sao cho Phase 1 chạy được độc lập nhưng **không phải đập đi làm lại** ở Phase 2. Hãy chỉ rõ những abstraction nào cần đặt sẵn từ Phase 1 (ví dụ: `DocumentAnchor` phải tổng quát cho cả field-based và paragraph-based) và những gì cố ý hoãn.

### 2.3. KẾT QUẢ KHẢO SÁT HỢP ĐỒNG KHUNG THẬT — ĐỌC KỸ MỤC NÀY

Đã phân tích một hợp đồng khung thật đang lưu hành (`HOP DONG MUA XE VAN - VINH TƯƠNG (FN Review)`), bằng công cụ `scripts/inspect-template.py` (có sẵn trong repo, chạy được trên mọi `.docx`). **Đây là dữ liệu thực tế, không phải giả định — mọi thiết kế phải khớp với nó.**

Chạy lại bất cứ lúc nào:

```bash
python3 scripts/inspect-template.py "<file.docx>"          # đầy đủ
python3 scripts/inspect-template.py --quiet "<file.docx>"  # ẩn nội dung
python3 scripts/inspect-template.py --json  "<file.docx>"  # cho pipeline
```

#### F1 — Cơ chế vùng mở: **Range Permission**, đã xác nhận

`w:documentProtection` với `edit=readOnly`, `enforcement=1`, **có password hash**. Toàn bộ tài liệu read-only, mở ra **16 vùng ngoại lệ** `w:permStart`/`w:permEnd` với `edGrp=everyone`.

**Không có một Content Control (`w:sdt`) nào. Không có một Legacy Form Field nào.**

Hệ quả: quyết định C2 khớp thực tế, nhưng **API lock-mode content control của SuperDoc không áp dụng trực tiếp được**. Câu hỏi PoC số 1 trở thành: **engine được chọn có đọc/ghi/bảo toàn `w:permStart`/`w:permEnd` không?**

#### F2 — ID vùng mở vô nghĩa, không có tên

Các id là số nguyên ngẫu nhiên (`1808140627`, `293691561`, `2126520588`…). **Không có `w:tag`, không có `alias`, không có bất kỳ metadata nào cho biết vùng đó là gì.** Range Permission không hỗ trợ đặt tên — khác hẳn Content Control.

Hai việc bắt buộc phải thiết kế:

1. **Lớp đăng ký template**: Legal (hoặc IT) phải ánh xạ từng perm id → tên nghiệp vụ (`contract_number`, `seller_block`, `contract_value`, `payment_terms`…), kiểu dữ liệu, clause liên kết, và ràng buộc validate. Đây là bảng `template_field_map` trong DB.
2. **Kiểm tra tính ổn định của id qua round-trip Word** — nếu Word sinh lại id sau khi user mở/lưu (PT3), toàn bộ mapping vỡ. **Hạng mục PoC bắt buộc.**

Đề xuất mạnh để bạn thẩm định: **lúc đăng ký template, tự động bọc mỗi perm range bằng một Content Control mang `w:tag` semantic ổn định, vẫn giữ nguyên perm range bên trong.** Được cả ba: định danh bền vững, tương thích engine nói ngôn ngữ SDT, và có anchor sẵn cho comment. Hãy đánh giá rủi ro của phép biến đổi này (có làm hỏng Restrict Editing / format không) và đưa vào PoC.

#### F3 — Vùng mở KHÔNG đồng nhất: hai bài toán khác nhau trong cùng một tài liệu

| Nhóm | Ví dụ thật | Độ dài | Bản chất |
|------|-----------|--------|----------|
| Ô giá trị nhỏ | `03`, `05`, `30` (số ngày), `______` (số HĐ) | 2–6 ký tự | Điền giá trị, validate kiểu dữ liệu |
| Giá trị ngắn | tên hàng hoá, giá trị HĐ + bằng chữ, địa điểm giao hàng | 26–59 | Điền giá trị, cần cross-check |
| Khối trung bình | chứng từ kèm theo (91), điều khoản bảo hành (222) | 91–222 | Văn bản có cấu trúc |
| **Khối lớn** | **khối thông tin Bên Bán (521), toàn bộ điều khoản Thanh toán (3.174), Phụ lục danh mục hàng hoá (701)** | 521–3.174 | **Văn bản tự do — redlining thật sự** |

Nghĩa là giả định "Phase 1 chỉ là điền field" **đúng một phần**. Vùng `1623331172` chứa **nguyên điều khoản Thanh toán 3.174 ký tự** — đây là văn bản tự do, cần đúng năng lực AI của Phase 2.

**Việc bạn phải làm:** phân loại vùng mở thành ít nhất hai `field_kind` (`scalar` và `clause_block`) ngay từ lớp đăng ký template, và thiết kế **hai đường xử lý khác nhau**: `scalar` dùng form input + validate deterministic + không cần LLM sinh văn bản; `clause_block` dùng editor + LLM redlining + track changes. Đừng thiết kế một đường chung cho cả hai.

#### F4 — Vùng mở nằm trong bảng và bắc qua ranh giới bảng

3/16 vùng nằm trong bảng; **2 trong số đó bắc qua ranh giới bảng** (`2126520588` khối thông tin các bên, para 7–46; `1572674833` phụ lục hàng hoá, para 185–229). Một vùng trải 40 paragraph xuyên nhiều ô bảng.

Đây là ca khó nhất của write-back OOXML: không thể coi vùng mở là "một đoạn text liền mạch". Writer phải làm việc trên **danh sách run rời rạc nằm trong nhiều cell khác nhau**. **Hạng mục PoC bắt buộc** — nếu engine không xử lý được ca này, phải đổi engine hoặc đề nghị Legal tái cấu trúc template.

Ngoài ra vùng `1808140627` **rỗng hoàn toàn (0 ký tự)** ở đầu tài liệu — rác. Lớp đăng ký template cần có lint chặn những vùng thế này.

#### F5 — Số điều khoản KHÔNG nằm trong text (phát hiện quan trọng, dễ bỏ sót)

Style `Heading1`…`Heading4` đều trỏ `numId=3` → `abstractNum 0`, với `lvlText`:

```
lvl0 = "Điều %1."     lvl1 = "%1.%2"     lvl2 = "%3."     lvl3 = "(%4)"
```

Nghĩa là **"Điều 4.", "4.1", "a.", "(i)" đều do Word sinh ra lúc render, không tồn tại trong luồng text.** Trích xuất text thuần cho ra `"Thanh toán"` chứ không phải `"Điều 4. Thanh toán"`.

Hệ quả dây chuyền, phải xử lý hết:

- AI **không thể trích dẫn số điều khoản** → trường `code` trong checklist của Legal không map được vào tài liệu.
- Comment của người duyệt viết *"Nhờ Vũ chỉnh lại điều 3.5 và 3.6"* — **không thể tìm được bằng string search** vì "3.5" không có trong text.
- Việc phân đoạn tài liệu thành clause unit (Stage 0 của pipeline AI) không dựa được vào text.

Bạn phải thiết kế **bộ resolve numbering**: đọc `styles.xml` → `numPr` của style → `numbering.xml` → `abstractNum` → `lvlText`, rồi đếm tuần tự theo cấp để tính ra số thật của từng đoạn. Đây là việc tái hiện engine đánh số của Word — không tầm thường. Hãy cân nhắc: tự viết, hay dùng engine đã chọn (LibreOffice headless / SuperDoc / ONLYOFFICE) để render ra text đã có số. Nêu rõ trade-off.

#### F6 — Comment thật đều neo trong vùng mở, nhưng nội dung lại đòi sửa vùng khoá

3 comment thật trong file, cả 3 đều neo vào **vùng mở** `1623331172` (điều khoản Thanh toán) — tin tốt cho phương án PA-B.

Nhưng nội dung comment `[9]` là *"Nhờ Vũ chỉnh lại điều 3.5 và 3.6 cho phù hợp vs mặt hàng đang mua"*, và comment `[8]` đưa hẳn **văn bản thay thế đề xuất cho điều 3.5** — trong khi bản đồ khoá/mở (F10) xác nhận **Điều 3.5 và 3.6 đều nằm hoàn toàn trong vùng KHOÁ**.

Đây là bằng chứng thực tế rằng **người duyệt thật sự có nhu cầu sửa vùng khoá**. Thiết kế hiện tại chỉ trả lời "Loại B — chỉ annotation, không ghi đè", nhưng đó là ngõ cụt về vận hành. Bạn phải thiết kế **đường escalate**: yêu cầu sửa vùng khoá đi đâu, ai duyệt, kết quả là Legal sửa template (tạo version template mới) hay lập phụ lục, và hệ thống theo dõi trạng thái đó thế nào. Đây là khoảng trống nghiệp vụ mà Blueprint chưa nghĩ tới — hãy nêu rõ để BA bổ sung.

#### F7 — File có lỗi thật, và đúng loại lỗi AI phải bắt được

Cùng một số tiền `685.000.000 VND` được ghi bằng chữ **hai kiểu khác nhau** trong cùng hợp đồng:

| Vị trí | Ghi bằng chữ | Đánh giá |
|--------|--------------|----------|
| Vùng `1436427308` — Giá trị Hợp Đồng | "Sáu trăm tám lăm **triệu** đồng chẵn" | đúng |
| Vùng `1623331172` — điều khoản Thanh toán | "Sáu trăm tám mươi lăm **nghìn** đồng chẵn" | **SAI, lệch 1.000 lần** |
| Giá trị bảo lãnh (trong cùng vùng Thanh toán) | "Sáu trăm tám mươi lăm **nghìn** đồng chẵn" | **SAI** |

Rút ra hai điều quan trọng:

1. **Đây là golden-set case hoàn hảo.** Dùng chính file này làm ca kiểm thử đầu tiên, và mang ra demo cho stakeholder — nó chứng minh giá trị hệ thống bằng một lỗi có thật trong hợp đồng đang lưu hành.
2. **Cần một tầng "consistency rules" riêng, chạy bằng code chứ không phải LLM.** Loại kiểm tra này deterministic, rẻ, chính xác 100%, và bắt được lỗi mà LLM dễ bỏ qua. Tối thiểu: số ↔ chữ, giá trị HĐ ↔ tổng phụ lục, thứ tự các mốc ngày, tên/mã số thuế các bên nhất quán giữa phần mở đầu và phần ký, đơn vị tiền tệ. Hãy thiết kế tầng này như **thành phần bậc một trong pipeline** (chạy song song với checklist review), có bộ rule cấu hình được, và kết quả gộp chung vào 4 nhóm phát hiện. `scripts/inspect-template.py` đã có một rule mẫu.

#### F8 — Quy mô tài liệu rất nhỏ so với năng lực hạ tầng

230 đoạn, 4 bảng, 0 ảnh, **23.313 ký tự** (~8–10K token). Với 2× A100, cả tài liệu thừa sức nằm gọn trong context. **Hiệu năng không phải vấn đề của dự án này** — đừng tối ưu sớm. Ưu tiên độ chính xác và khả năng truy vết, không phải throughput. Điều này cũng nới lỏng ràng buộc ở mục 7.2: vẫn nên chia theo clause để truy vết được, nhưng không bị ép vì giới hạn context.

#### F9 — File khảo sát là hợp đồng đã điền, không phải template trắng

File chứa dữ liệu thật (bên bán THACO, giá trị 685 triệu, tên người đại diện thật) và comment review thật đề ngày 30/07/2026. Nó là **artifact đang trong vòng review**, không phải bản mẫu trắng.

Cần làm rõ với nghiệp vụ (đưa vào mục câu hỏi mở): tồn tại **bản template trắng** do Legal ban hành để hệ thống instantiate không, hay thực tế Purchasing luôn copy từ một hợp đồng cũ rồi sửa? Nếu là vế sau thì đường "instantiate from template" ở mục 5.1 cần Legal chuẩn bị bản trắng trước — đây là việc tổ chức, không phải việc kỹ thuật, nhưng chặn tiến độ.

#### F10 — Bản đồ khoá/mở: Legal khoá khung pháp lý, mở thông số thương mại

Công cụ `scripts/map-locked-regions.py` dựng bản đồ vùng khoá/mở cho toàn tài liệu (vùng khoá = phần bù của perm range), kèm bộ **resolve numbering prototype** khôi phục số điều khoản từ `styles.xml` + `numbering.xml` — giải quyết được F5 và đã chạy đúng.

```bash
python3 scripts/map-locked-regions.py --outline      "<file.docx>"  # dàn ý điều khoản
python3 scripts/map-locked-regions.py --locked-only  "<file.docx>"  # chỉ vùng khoá
python3 scripts/map-locked-regions.py                "<file.docx>"  # bản đồ đầy đủ
```

Tỷ lệ: **17.987 ký tự khoá (78,0%) / 5.082 ký tự mở (22,0%)**. Đoạn: 91 khoá · 90 mở · **10 hỗn hợp**.

| Điều | Tên | % mở |
|------|-----|------|
| 1 | Hàng Hóa | 17% |
| 2 | Đơn Đặt Hàng | 0% |
| 3 | Giao hàng | 8% |
| **4** | **Thanh toán** | **99%** |
| **5** | **Bảo hành** | **96%** |
| 6 | Cam kết liên quan đến Hàng Hóa | 0% |
| 7 | Cam kết về năng lực Bên Bán | 0% |
| 8 | An toàn lao động | 0% |
| 9 | Phạt vi phạm và bồi thường | 0% |
| 10 | Sự kiện bất khả kháng | 0% |
| 11 | Bảo mật thông tin | 0% |
| 12 | Chống tham nhũng & hệ thống cảnh báo | 0% |
| 13 | Thời hạn, chấm dứt và hậu quả | 0% |
| 14 | Điều khoản cuối cùng | 0% |

(Khối chữ ký và Phụ lục 01 nằm sau Điều 14, đều là vùng mở.)

Ý đồ thiết kế của Legal rất rõ và rất nhất quán: **Điều 6 → Điều 14 khoá tuyệt đối** — đó là toàn bộ khung pháp lý bảo vệ Saint-Gobain (cam kết chất lượng, năng lực NCC, an toàn lao động, chế tài, bất khả kháng, bảo mật, chống tham nhũng, chấm dứt, luật áp dụng và cơ chế giải quyết tranh chấp). Phần mở chỉ là **thông số thương mại của từng thương vụ**: các bên, hàng hoá, giá trị, mốc thời gian, điều kiện thanh toán, bảo hành, phụ lục.

Ba hệ quả thiết kế:

1. **Điều 4 (Thanh toán) là ngoại lệ lớn.** Mở 99%, 3.173 ký tự văn bản tự do gồm cả lịch thanh toán, hồ sơ thanh toán và bảo lãnh tạm ứng. Đây là nơi rủi ro tài chính tập trung, cũng là nơi chứa lỗi số ↔ chữ ở F7, và là nơi cả 3 comment thật neo vào. **Ưu tiên số 1 cho AI review, và là vùng duy nhất trong Phase 1 thật sự cần redlining tự do.**
2. **10 đoạn hỗn hợp — vùng mở nằm GIỮA câu bị khoá.** Ví dụ điều 3.1: *"Bên Bán giao hàng cho Bên Mua trong vòng `[30]` ngày kể từ ngày `[ký hợp đồng]`."* — khung câu do Legal khoá, chỉ hai giá trị được mở. Nghĩa là **write-back phải ở cấp `w:r` (run) bên trong paragraph, không phải cấp paragraph.** Đề xuất sửa của AI phải nhắm đúng run mở nằm giữa các run khoá. Đây là yêu cầu kỹ thuật cứng cho writer OOXML và cho engine editor.
3. **Xác nhận F6 bằng dữ liệu:** điều 3.5 và 3.6 khoá 100%, mà người duyệt thật lại đề xuất văn bản thay thế cho chúng. Nhu cầu sửa vùng khoá là có thật, không phải giả định.

#### Tổng hợp tác động lên thiết kế

| Phát hiện | Ảnh hưởng |
|-----------|-----------|
| F1 Range Permission, không có SDT | Câu hỏi PoC số 1 cho Word engine đổi thành: có hỗ trợ `permStart/permEnd` không |
| F2 ID vô nghĩa | Bắt buộc có lớp `template_field_map`; cân nhắc auto-wrap thành SDT |
| F3 Vùng mở hỗn hợp | Hai đường xử lý `scalar` vs `clause_block` |
| F4 Vùng bắc qua bảng | Writer OOXML phải xử lý run rời rạc xuyên cell — PoC bắt buộc |
| F5 Số điều do numbering sinh | Bắt buộc có bộ resolve numbering, nếu không sẽ mất khả năng trích dẫn điều khoản |
| F6 Comment đòi sửa vùng khoá | Thiết kế đường escalate — khoảng trống nghiệp vụ mới |
| F7 Lỗi số ↔ chữ có thật | Thêm tầng consistency rules deterministic; dùng làm golden-set case đầu tiên |
| F8 Tài liệu nhỏ | Không tối ưu hiệu năng sớm; ưu tiên độ chính xác và truy vết |
| F9 Chưa có template trắng | Xác nhận với Legal, chặn đường instantiate |
| F10 78% khoá, Điều 6–14 khoá tuyệt đối | Xác nhận mô hình bảo vệ; Điều 4 Thanh toán là trọng tâm AI |
| F10 10 đoạn hỗn hợp | **Write-back phải ở cấp run, không phải cấp paragraph** |

---

## 3. HIỆN TRẠNG REPO

```
/
├── frontend/                  # Next.js 14 App Router + TS + Tailwind + shadcn/ui — DEMO, mock backend
│   └── src/lib/               # Toàn bộ domain model & service (mock + nhánh REST)
├── prompts/                   # System prompt 4 stage + injection guard (file-based, quản lý bằng Git)
├── scripts/validate-prompts.js
├── docs/
│   ├── requirements-alignment/  # 00-pm-roadmap → 07-econtract-integration
│   ├── Tài _liệu_API.pdf        # Spec API FPT.eContract
│   └── Hướng-dẫn-cấu_trúc-đánh-dấu-marker.docx
├── SGB_AILegal_Blueprint_Sprint1_v11.docx   # Blueprint BA
└── README.md
```

### Backend: **CHƯA CÓ GÌ**

FE gọi `NEXT_PUBLIC_API_URL` (mặc định `http://localhost:8000`) — chưa có server nào. Toàn bộ backend phải xây mới.

### Tài sản FE tái sử dụng được (port sang BE)

| Tài sản | File | Ghi chú |
|---------|------|---------|
| Phân tích OOXML vùng mở/khoá | `frontend/src/lib/docx/content-controls.ts` | Đọc `w:sdt`, `w:permStart/End`, `w:documentProtection`, `w:lock`. **Đang parse bằng regex trên raw XML — BE phải viết lại bằng XML parser thật.** Chưa hỗ trợ Legacy Form Field |
| Validate reupload PT3 | `reupload-validation.ts`, `reupload-validation-node.ts` | Logic tốt: so sánh field theo `w:tag`, `lockedFingerprint` hash vùng khoá, phát hiện `missing_field` / `locked_region_modified` / `unexpected_new_field` |
| Validate marker eContract | `review-service.ts` → `validateMarkers()` | 8 luật theo bảng mã lỗi FPT — BE **bắt buộc** validate lại lần 2 với cùng mã lỗi |
| Dựng payload eContract | `review-service.ts` → `buildEcontractPayload()` | Đúng cấu trúc excall của FPT |
| Domain model | `types.ts`, `config-types.ts` | Làm cơ sở cho DB schema & API — **giữ nguyên tên field** để FE không phải sửa nhiều |
| Bộ prompt 4 stage + injection guard + CI | `prompts/`, `scripts/validate-prompts.js` | Đã có, chưa nối vào pipeline nào |

### Thứ trong FE demo **PHẢI BỎ**, không được bê sang BE

1. `contract-insight.ts` — công thức scoring heuristic hardcode (`55 − 22·redFlag − 14·missing − 8·warn + 18·protection`) và các bump `confidence + 1` mỗi lần sửa. Vô nghĩa về nghiệp vụ.
2. String-replace trên plain text để "accept proposal". BE phải ghi OOXML thật.
3. `PATCH /api/reviews/{id}/document { text }` — nhận **toàn văn bản** làm payload. **Endpoint này phá vỡ allow-list vùng khoá, phải loại bỏ.** Thay bằng ghi cấp field/anchor.
4. Autosave — quyết định A4c yêu cầu **lưu thủ công** cho mọi chỉnh sửa, có dialog Lưu / Thoát không lưu / Huỷ, bắt buộc lưu xong mới submit.
5. `listReviews` filter quyền là no-op (`ownerName.includes(...) || true`). RBAC phải enforce **server-side**.
6. File map cứng sang `/samples/*.docx` và lưu `localStorage`.
7. Attachment chỉ lưu `{name, size}` — phải lưu nội dung thật (A4).

### Trạng thái prompt hiện tại

4 stage trong `prompts/`: `checklist_review`, `chat_edit`, `ai_summary_fairness`, `field_validation`, cộng `_shared/injection_guard.md` được prepend vào mọi stage. Con trỏ version qua `current.json`. CI `validate-prompts` chặn placeholder lạ và chặn hardcode nội dung pháp lý (regex bắt các pattern kiểu `60 ngày`).

**Nguyên tắc bất di bất dịch:** nội dung pháp lý (Ideal / Fallback / Red Line / severity / keywords) **thuộc Legal**, nằm trong DB checklist, inject vào prompt qua `{{checklist_items}}`. System Prompt **chỉ mô tả hành vi AI**, thuộc IT, quản lý bằng Git.

**Vấn đề hiện tại:** các prompt v1 chỉ nói "trả về JSON có cấu trúc rõ ràng" mà **không định nghĩa schema**. Bạn phải thiết kế JSON schema chặt cho từng stage và đề xuất bản `v2.md` tương ứng.

---

## 4. RÀNG BUỘC CỨNG

| # | Ràng buộc | Nguồn |
|---|-----------|-------|
| C-1 | **LLM chạy local, tuyệt đối không gọi cloud AI.** Dữ liệu hợp đồng không rời hạ tầng nội bộ | README + NFR-S1 |
| C-2 | Output `.docx` **giữ format giống hệt input** | NFR-R4 |
| C-3 | **Không bao giờ được ghi vào vùng khoá.** Allow-list Lớp 1 nằm ở tầng ghi file backend — diff ngoài allow-list bị loại bỏ ngay cả khi FE bị bypass | NFR-S3 |
| C-4 | PT3 reupload phát hiện vùng khoá bị sửa / mất `permStart` → **chặn hoàn toàn, không có cơ chế override** | C5 |
| C-5 | Chỉ gọi eContract **sau khi Legal approve**. Chiều nhận file đã ký **ngoài scope** (hệ thống hiện hữu lo) | D1d |
| C-6 | Approval Matrix Sprint 1 **chỉ dùng để cảnh báo + tính % tin cậy**, tuyệt đối không auto-routing | A3 |
| C-7 | Queue xử lý **FIFO**, không ưu tiên | A8 |
| C-8 | Marker phải chèn bằng **mực trắng** (`w:color w:val="FFFFFF"`), id duy nhất toàn file | Tài liệu FPT |
| C-9 | Kết quả AI **chỉ là gợi ý**; disclaimer bắt buộc trên UI và trong file xuất ra; trách nhiệm cuối thuộc người phê duyệt | A9 |
| C-10 | Checklist do Legal tự vận hành trên UI, **không cần deploy** khi thay đổi | NFR-M1 |
| C-11 | System Prompt quản lý bằng Git + CI validate bắt buộc pass trước merge | NFR-M2 |
| C-12 | Không hardcode nội dung pháp lý trong prompt hoặc trong code | NFR-M3 |

### Quyết định nghiệp vụ đã chốt (không cần hỏi lại)

- **A4b:** Sửa/comment yêu cầu chỉnh → bắt buộc Reject. Không có "sửa + approve".
- **A4c:** Lưu thủ công cho **mọi** chỉnh sửa, không autosave.
- **A5:** Purchasing chỉ thấy ticket của chính mình. Manager thấy ticket của user có Line Manager = mình.
- **A6 — ĐÃ BỎ:** không so khớp **nội dung** file review với template khi upload. (Xem cảnh báo ở mục 5.1 — điều này **không** có nghĩa là bỏ kiểm tra cấu trúc.)
- **A7 / D1f:** Gán marker bằng **kéo-thả trên preview**, không dùng danh sách vị trí định sẵn.
- **A10:** Bỏ Import/Export checklist khỏi Sprint 1.
- **Cấu hình checklist:** bỏ workflow Draft/Publish, chỉ còn Sửa + Lưu. Bản đã Lưu áp dụng ngay cho AI review.
- **D1c:** Gửi file lên FPT dưới dạng **base64**.
- **D3:** PM chốt "lưu file trong DB". Xem phản biện ở mục 6.4.
- **D7:** Audit log lưu thời gian + giá trị **cũ → mới** của mỗi thay đổi.

---

## 5. REVIEW BLUEPRINT — CÁC VẤN ĐỀ BẠN PHẢI XỬ LÝ

Đây là kết quả review Blueprint v1.11. Technical Solution phải **giải quyết hoặc nêu rõ cách xử lý** từng điểm.

### 5.1. Mâu thuẫn nghiêm trọng: bỏ template matching vs. mô hình bảo vệ vùng khoá

Blueprint v1.6 bỏ hoàn toàn việc so khớp file review với template ("upload `.docx` hợp lệ là đủ để vào queue"). Nhưng Phase 1 lại dựa **hoàn toàn** vào giả định "file có cấu trúc khoá đúng như template Legal ban hành".

Nếu không kiểm tra gì, kịch bản sau xảy ra: Purchasing tải template về, gỡ Restrict Editing (hoặc dùng file cũ / file đã bị sửa), upload lên — hệ thống coi toàn bộ tài liệu là vùng mở và AI được phép ghi đè điều khoản pháp lý. **Toàn bộ mô hình an toàn sụp đổ.**

**Bạn phải đề xuất giải pháp phân biệt rõ hai khái niệm:**

- **So khớp nội dung** (đã bỏ — đúng, vì dễ false positive khi vùng mở thay đổi hợp lệ).
- **Ràng buộc cấu trúc** (structural binding — **bắt buộc phải có**): kiểm tra inventory vùng khoá/vùng mở của file upload có khớp với template đã đăng ký của loại HĐ không — số lượng + `w:tag`/id của content control & permission range, cộng hash nội dung vùng khoá. Đây chính là tiêu chí PM đã từng gợi ý ở A6 và cũng chính là logic `reupload-validation.ts` đã có sẵn.

**Hướng xử lý đã được chủ dự án chốt — thiết kế theo đúng hướng này:**

- **Đường chính (primary):** Purchasing chọn loại HĐ → hệ thống **instantiate tài liệu từ template đã đăng ký** trong cấu hình Legal. Không upload. Khi đó inventory vùng mở/khoá là **đã biết trước và tin cậy tuyệt đối** vì file do chính hệ thống sinh ra.
- **Đường phụ (secondary):** vẫn cho phép upload `.docx`, nhưng **bắt buộc đi qua structural binding** — đối chiếu inventory vùng khoá/vùng mở của file upload với template đã đăng ký (số lượng + `w:tag`/id của content control & permission range, cộng hash nội dung vùng khoá). Không khớp → chặn, không có override (nhất quán với C-4).

Bạn phải thiết kế cả hai đường, làm rõ: template được đăng ký và versioning ra sao trong cấu hình Legal; khi Legal cập nhật template thì các review đang chạy trên bản cũ xử lý thế nào; và thông báo lỗi structural binding phải nói được **cụ thể sai ở đâu** để Purchasing tự sửa (tái dùng kiểu `FieldStructureIssue[]` của `reupload-validation.ts`). Đồng thời nêu rõ tác động lên Blueprint để BA cập nhật (mục VI.1.3.3 form tạo tài liệu hiện đang bắt buộc upload 1 file).

### 5.2. Blueprint không có phần kỹ thuật

Blueprint mô tả màn hình và quy tắc nghiệp vụ rất kỹ nhưng **không có**: kiến trúc, data model, API, state machine đầy đủ, cơ chế queue, cơ chế lưu file, mô hình đồng thời (concurrency), non-functional. Toàn bộ phần này phải do Technical Solution tạo mới. Đừng giả định Blueprint đã trả lời.

### 5.3. Vấn đề anchor của comment và Track Changes (mục VI.3.3.8)

Blueprint nêu hai phương án PA-A / PA-B nhưng để ngỏ cho Tech Design. Đây là bài toán kỹ thuật khó nhất sau OOXML write-back.

Bạn phải thiết kế **anchor model** cụ thể, trả lời được:
- Neo comment vào cái gì để nó sống sót qua các vòng chỉnh sửa? (Gợi ý: với vùng mở dùng `w:tag` của content control — ổn định qua round-trip Word. Với vùng khoá dùng fingerprint = hash text đã normalize + ordinal của paragraph.)
- Khi Purchasing upload file mới (TH3), comment cũ xử lý thế nào? Trạng thái `orphaned` hiển thị ra sao?
- PA-A và PA-B nên chọn cái nào, hay dùng cả hai? (Khuyến nghị của chủ dự án: **DB là nguồn sự thật (PA-A luôn bật)**, ghi `w:comment` vào .docx chỉ là tính năng export/đồng bộ (PA-B) — vì file có thể bị thay thế hoàn toàn.)
- Track Changes của Manager/Legal phải **tách lớp** với diff AI. Mô hình dữ liệu nào biểu diễn được nhiều lớp diff chồng nhau trên cùng tài liệu?

### 5.4. Chưa có định nghĩa "% tin cậy" và "Fairness Score"

Blueprint chỉ mô tả ý nghĩa, không có công thức (câu hỏi B2 vẫn treo). FE demo dùng heuristic vô nghĩa. Bạn phải đề xuất **công thức đầy đủ, giải thích được, kiểm toán được** — xem mục 7.4.

### 5.5. Marker kéo-thả (A7) chưa có lời giải backend

A7 chốt kéo-thả trên preview, nhưng D1f phần backend "chờ Workshop 2": **UI trả về cái gì để backend biết chèn marker vào đâu trong OOXML?** Toạ độ pixel trên trang render **không** map trực tiếp sang vị trí OOXML.

Bạn phải giải bài này. Gợi ý hướng: kéo-thả xong thì lấy **node/paragraph anchor** gần nhất từ editor (nếu dùng editor có API node id) chứ không lấy toạ độ; hoặc chèn một content control placeholder ở vị trí thả rồi ghi marker vào đó.

### 5.6. Không có xử lý đồng thời (concurrency)

Blueprint không nói gì về việc: 2 tab cùng mở 1 review, Manager đang comment trong khi Purchasing đang sửa, job AI đang chạy trong khi user sửa field. Cần optimistic locking (version/ETag) và quy tắc khoá theo trạng thái.

### 5.7. Fallback rule-based khi LLM lỗi (B4) chưa có thiết kế

NFR-R1 yêu cầu, code chưa có gì. Phải thiết kế: fallback làm được đến đâu (chỉ tầng keyword/regex?), đánh dấu kết quả là fallback thế nào trong data model và trên UI.

### 5.8. Legacy Form Field — đã khảo sát, có thể hoãn

C2 chốt thứ tự ưu tiên có Legacy Form Field, nhưng code FE chỉ đọc `w:sdt` và `w:permStart`. Khảo sát hợp đồng khung thật (mục 2.3, F1) cho thấy **template dùng thuần Range Permission, không có Legacy Form Field nào**.

Đề xuất: **hoãn hỗ trợ Legacy Form Field sang Phase 2**, chỉ giữ khả năng phát hiện và cảnh báo rõ nếu gặp. Nhưng phải xác nhận mẫu này đại diện cho tất cả loại hợp đồng khung (xem câu hỏi 5 mục 12) trước khi chốt hoãn.

### 5.9. Rủi ro tiến độ

Mốc: tháng 9 test, tháng 10 pilot. Backend = 0 dòng code, LLM chưa chọn, chưa có credentials FPT (D1e), chưa chốt stack editor. Risk R2 (P4×I5 = Cao) và R13 (scope Rev12 lớn hơn demo nhiều) là có thật.

**Technical Solution phải kèm đánh giá tính khả thi thẳng thắn** và đề xuất **cắt scope theo lát cắt dọc (vertical slice)** để có thứ chạy được sớm, thay vì làm ngang từng tầng. Nếu bạn cho rằng mốc không khả thi, hãy nói rõ và đề xuất phương án tối thiểu cho pilot.

---

## 6. ĐỊNH HƯỚNG BACKEND (phản biện và chi tiết hoá)

### 6.1. Stack — ĐÃ CHỐT: Python

Team backend là team Python. **Stack chính đã chốt, không cần đề xuất lại ngôn ngữ.** Việc của bạn là chi tiết hoá các thành phần còn lại và phản biện những lựa chọn cụ thể bên dưới.

| Thành phần | Đề xuất | Lý do |
|-----------|---------|-------|
| API | **Python 3.12 + FastAPI** (đã chốt) | Cùng ngôn ngữ với toàn bộ tầng AI (vLLM client, embedding, eval); Pydantic sinh OpenAPI khớp type FE; hệ sinh thái OOXML (`lxml`) tốt |
| Worker | **Celery** hoặc **Arq** + Redis | Job AI chạy dài, cần persistent queue (NFR-R3) |
| DB | **PostgreSQL 16** | JSONB cho findings/intake, transactional outbox, row-level security |
| Object storage | **MinIO** (S3-compatible, self-hosted) | Lưu `.docx` mọi version. Xem phản biện D3 ở 6.4 |
| Cache / broker | **Redis** | Queue broker, token cache eContract, rate limit |
| LLM serving | **vLLM** (OpenAI-compatible endpoint) | Batching, guided decoding, throughput |
| Reverse proxy | Nginx / Traefik | TLS nội bộ |
| Deploy | Docker Compose (Sprint 1) → K8s nếu cần | Team nhỏ, ưu tiên đơn giản |

**Lưu ý về hệ quả của việc chốt Python:** nếu Word engine được chọn (mục 8) chỉ có SDK Node là first-class, bạn phải thiết kế cách bắc cầu. SuperDoc có Python SDK và CLI nên về nguyên tắc dùng trực tiếp từ Python được — nhưng **PoC phải xác minh Python SDK có đủ tính năng ngang bản Node hay không**. Nếu không đủ, hãy thiết kế **document-engine sidecar bằng Node** (service nội bộ nhỏ, giao tiếp qua HTTP/gRPC, chỉ làm nhiệm vụ thao tác OOXML) và giữ toàn bộ nghiệp vụ + AI ở Python. Nêu rõ ranh giới trách nhiệm và contract giữa hai service nếu chọn hướng này.

### 6.2. Phân rã module backend

Đề xuất khung sau, bạn tự do điều chỉnh:

```
app/
├── api/            # FastAPI routers — thin, chỉ validate + gọi service
├── domain/         # Entities, state machine, business rules (không phụ thuộc framework)
├── services/
│   ├── review/         # Vòng đời review, version, submit/approve/reject
│   ├── document/       # ★ OOXML: parse, field inventory, write-back, comment, track changes, marker
│   ├── ai/             # ★ Pipeline AI: retrieval, judging, scoring, chat
│   ├── config/         # Checklist, Approval Matrix, Form lists, audit config
│   ├── econtract/      # Outbound FPT, outbox, reconciliation
│   ├── identity/       # Users, RBAC, permission
│   └── storage/        # Object storage abstraction, signed URL
├── workers/        # Celery tasks: ai_review, ai_chat, econtract_push, reconcile
├── infra/          # DB, redis, minio, vllm client, settings
└── prompts/        # Loader đọc /prompts (Git), render placeholder, cache + invalidate
```

Hai module đánh dấu ★ là nơi tập trung toàn bộ độ khó. Chúng phải được thiết kế như **thư viện độc lập, test được riêng**, không dính FastAPI.

### 6.3. Data model — điểm cần thiết kế kỹ

Bám tên field trong `frontend/src/lib/domain/types.ts` để FE không phải refactor. Các bảng tối thiểu:

`users`, `contract_reviews`, `review_versions`, `review_files`, `document_fields`, `ai_runs`, `ai_findings`, `ai_proposals`, `chat_messages`, `comments`, `comment_replies`, `legal_edits` (track changes), `sign_recipients`, `markers`, `econtract_envelopes`, `econtract_outbox`, `contract_type_configs`, `checklist_clauses`, `approval_matrices`, `form_lists`, `audit_log`.

Điểm cần chú ý đặc biệt:

- **`review_versions` là immutable snapshot.** Một bộ đếm chung tăng dần, không phân biệt actor (v1 submit → v2 reject kèm sửa → v3 resubmit). Mỗi version lưu: người thao tác, hành động, file blob hash, diff cấp field, feedback phát sinh.
- **`ai_runs` phải đủ để tái lập kết quả:** `model_id`, `model_hash`, `prompt_stage`, `prompt_version` (hash file `vN.md` + injection guard), `checklist_config_version`, `document_version`, `temperature`, `seed`, `input_token`, `output_token`, `latency_ms`, `status`, `is_fallback`. Không có cái này thì không audit được kết luận AI — mà đây là hệ thống pháp chế.
- **`document_fields`** là inventory vùng mở/khoá đã trích xuất, chính là **allow-list** dùng để enforce ghi.
- **`audit_log` append-only**, có trigger chặn UPDATE/DELETE, lưu `old_value → new_value` (D7).

### 6.4. Phản biện quyết định D3 "lưu file trong DB"

PM chốt lưu file trong DB. Với hợp đồng `.docx` nhiều version cộng file đã ký, việc nhồi blob vào PostgreSQL gây phình DB, backup chậm, replication nặng.

Hãy đề xuất phương án thoả hiệp và trình bày để thuyết phục PM: **metadata + hash trong DB, blob trong MinIO self-hosted** (vẫn nằm hoàn toàn trong hạ tầng nội bộ, thoả NFR-S1/S5), có mã hoá at-rest và truy cập qua signed URL ngắn hạn qua API kiểm quyền. Nếu bắt buộc phải trong DB thì nêu rõ giới hạn và cách giảm thiểu (`bytea` + partition + `TOAST`, hoặc Large Object).

### 6.5. State machine

FE đã có enum: `draft → queued → processing → reviewed → awaiting_markers → pending_manager → pending_legal → rejected | approved → syncing_econtract → signed`.

Bạn phải định nghĩa **bảng chuyển trạng thái đầy đủ**: (trạng thái hiện tại × hành động × role) → trạng thái mới, kèm điều kiện chặn (ví dụ: không submit được khi marker chưa hợp lệ, khi còn thay đổi chưa lưu, khi đang có job AI chạy). **Backend là nơi duy nhất được chuyển trạng thái.**

Thiếu trong enum hiện tại: trạng thái cho lỗi AI, lỗi đẩy eContract, và HĐ bị huỷ. Hãy bổ sung.

### 6.6. API

Toàn bộ endpoint FE đang gọi đã liệt kê trong `docs/requirements-alignment/04-api-contract.md`. Nhóm API config (`config-service.ts`) hiện **ném lỗi "API chưa sẵn sàng"** — bạn phải thiết kế mới hoàn toàn.

Nhớ: bỏ `PATCH /reviews/{id}/document`, thay bằng ghi theo anchor/field. Bổ sung nhóm còn thiếu: comments 2 chiều, legal-edits (track changes), file download theo version, queue status (SSE/WebSocket), econtract callback (nếu có).

---

## 7. ĐỊNH HƯỚNG AI / LLM — PHẦN QUAN TRỌNG NHẤT

### 7.1. Chọn model

Ràng buộc: chạy local, tiếng Việt tốt, hiểu văn bản pháp lý dài, xuất JSON có cấu trúc ổn định, license thương mại sạch.

Đề xuất để bạn thẩm định:

| Vai trò | Đề xuất | Ghi chú |
|---------|---------|---------|
| LLM chính | **Qwen3-30B-A3B** (MoE, ~3B active, Apache 2.0, context dài) phục vụ bằng vLLM, FP8/AWQ | Tiếng Việt tốt, throughput cao nhờ MoE, license sạch cho dùng nội bộ doanh nghiệp |
| LLM dự phòng / máy yếu | Qwen3-14B hoặc Gemma 3 27B | |
| Embedding | **BGE-M3** (MIT) hoặc **Qwen3-Embedding-8B** | Dùng cho semantic matching clause ↔ đoạn văn bản; BGE-M3 mạnh đa ngữ + hỗ trợ cả dense/sparse |
| Reranker | `bge-reranker-v2-m3` | Lọc lại cặp candidate trước khi đưa vào LLM |

Có các model chuyên ngành luật tiếng Việt (họ `ViLegalQwen`, `qwen3-*-vietnamese-legal-*`) nhưng **được huấn luyện cho hỏi-đáp luật Việt Nam (văn bản quy phạm pháp luật), không phải rà soát điều khoản hợp đồng thương mại**, và kích thước nhỏ (1.7B–4B). **Không dùng làm model chính.** Có thể tham khảo cho hướng fine-tune sau này.

### 7.1b. Hạ tầng GPU — ĐÃ CHỐT: 2× NVIDIA A100

Hạ tầng có **2 card A100** (cần xác nhận lại là bản 40GB hay 80GB — thiết kế mặc định theo 80GB, ghi rõ điều chỉnh nếu là 40GB).

Đây là cấu hình rất thoải mái cho bài toán này. Bạn phải đề xuất **kế hoạch phân bổ GPU cụ thể** và so sánh ít nhất hai phương án:

- **PA-1 (khuyến nghị khởi điểm):** Card 0 chạy LLM chính (vLLM, tensor-parallel = 1), Card 1 chạy embedding + reranker + làm headroom cho burst và cho môi trường UAT. Ưu điểm: cách ly lỗi, deploy/rollback model độc lập, không tranh chấp VRAM.
- **PA-2:** Tensor-parallel = 2 cho một model lớn hơn hoặc context dài hơn, embedding chạy CPU hoặc chung card. Ưu điểm: chất lượng/context cao hơn. Nhược: mọi thứ chết chung khi restart.

Với mỗi phương án nêu rõ: model + quantization (FP8/AWQ/BF16), `max_model_len`, `gpu_memory_utilization`, `max_num_seqs`, số worker Celery song song, và **tính toán capacity thực tế**: số lần gọi LLM trung bình cho một hợp đồng (bằng số clause trong checklist, xem câu hỏi 12 mục 12), token trung bình mỗi lần gọi, throughput ước tính, từ đó chứng minh đạt NFR-P1 (≥50 HĐ/ngày đỉnh) và NFR-P2 (≤10 phút/HĐ). Nếu số liệu cho thấy dư nhiều, hãy đề xuất tận dụng phần dư (ví dụ: chạy song song bộ eval golden set, hoặc model lớn hơn cho stage phán xét).

### 7.2. Kiến trúc pipeline AI — thiết kế theo hướng "không nhồi cả tài liệu vào 1 prompt"

Đây là khuyến nghị kiến trúc quan trọng nhất. Hãy thẩm định và chi tiết hoá:

```
[Stage 0] Ingestion
   .docx → OOXML parse → field inventory (open/locked)
        → segmentation thành clause units (Điều / Khoản / Điểm) kèm anchor
        → mỗi segment biết mình nằm trong vùng mở hay vùng khoá

[Stage 0.5] Consistency rules (KHÔNG dùng LLM — xem mục 2.3 F7)
   Bộ rule deterministic chạy song song với checklist:
     số tiền ↔ số tiền bằng chữ · giá trị HĐ ↔ tổng phụ lục
     thứ tự các mốc ngày · tên & MST các bên nhất quán đầu/cuối
     đơn vị tiền tệ · field bắt buộc còn rỗng ("______")
   Rẻ, chính xác 100%, bắt được lỗi LLM hay bỏ sót. Kết quả gộp vào 4 nhóm.

[Stage 1] Clause matching (KHÔNG dùng LLM)
   Với mỗi ChecklistClause của loại HĐ:
     - Tầng rule-based: keywords + patterns (regex) từ cấu hình Legal
     - Tầng semantic: embedding cosine(clause.standardText, segment) + rerank
   → sinh candidate pairs (clause × segment) + trạng thái "không tìm thấy segment nào"

[Stage 2] Per-clause judgment (LLM, prompt stage `checklist_review`)
   Mỗi cặp = 1 lần gọi LLM ngắn, chạy song song/batch, guided JSON decoding
   Output/clause: verdict ∈ {ideal_met, fallback_met, below_fallback,
                              red_line_violation, missing, not_applicable}
                  + evidence span (offset trong segment)
                  + proposed_text (chỉ khi vùng mở)
                  + rationale (tiếng Việt, ngắn)
                  + self_confidence

[Stage 3] Aggregation (KHÔNG dùng LLM)
   (clause.kind × clause.severity × verdict) → 1 trong 4 nhóm:
        red_flag | warning | protection | missing_protection
   Phân loại đề xuất Loại A (anchor nằm trong vùng mở) / Loại B (vùng khoá)
   → bảng ánh xạ này phải là bảng tra cứu tường minh trong tài liệu của bạn

[Stage 4] Scoring (KHÔNG dùng LLM — xem 7.4)
   aiConfidenceScore + fairnessScore tính bằng code deterministic

[Stage 5] Narrative (LLM, stage `ai_summary_fairness`)
   LLM chỉ viết đoạn tóm tắt tiếng Việt từ findings đã có
   LLM KHÔNG được sinh ra con số điểm

[Stage 6] Write-back
   proposals → lọc qua allow-list → ghi OOXML đúng field → version mới
```

Lợi ích: mỗi finding truy vết được về đúng 1 clause và 1 lần gọi LLM; prompt ngắn nên chính xác hơn; song song hoá được; token rẻ; lỗi cục bộ không phá cả kết quả.

Với **`chat_edit`** (PT1): trước khi gọi LLM phải resolve xem yêu cầu của user nhắm vào field/anchor nào. **Nếu anchor nằm ngoài allow-list → từ chối ngay, không gọi LLM** (yêu cầu tường minh trong README/Blueprint).

Với **`field_validation`**: chạy sau khi user lưu một field mở, chỉ đánh giá lại clause liên quan chứ không chạy lại toàn bộ.

### 7.3. Structured output

Dùng **guided decoding** của vLLM (xgrammar / outlines) với JSON Schema cho từng stage — không parse JSON bằng regex, không "hy vọng model trả đúng format". Kèm retry có giới hạn và validate bằng Pydantic. Bạn phải viết **JSON Schema đầy đủ cho cả 4 stage** và đề xuất bản `v2.md` của prompt tương ứng (nhớ: schema đặt trong prompt là mô tả **hành vi**, hợp lệ; nội dung pháp lý vẫn chỉ đến từ `{{checklist_items}}`).

Đặt `temperature=0` và cố định `seed` cho các stage phán xét. Chỉ stage tóm tắt được dùng temperature > 0.

### 7.4. Công thức % tin cậy và Fairness Score (trả lời câu hỏi B2)

**Yêu cầu bắt buộc: hai điểm số này phải do code tính, deterministic, giải thích được, tái lập được. LLM không được tự nghĩ ra con số.** Lý do: đây là hệ thống pháp chế, mỗi con số phải bảo vệ được trước Legal và audit.

Hai chỉ số **tách biệt hoàn toàn**:

- **AI Confidence Score** = độ chắc chắn của bản thân phân tích. Đề xuất thành phần đầu vào: tỷ lệ clause tìm được segment khớp (coverage), mức độ đồng thuận giữa tầng rule-based và tầng semantic, điểm similarity của match, self-confidence của LLM đã hiệu chuẩn, có phải kết quả fallback không, tỷ lệ clause `not_applicable`. Điểm này **thấp** nghĩa là "AI không dám chắc", chứ không phải "hợp đồng xấu".
- **Fairness Score** = mức cân bằng/có lợi của điều khoản cho Công ty. Tính từ tương quan giữa Red Flag / Missing Protection / Warning và Protection, **có trọng số theo `severity` của clause trong cấu hình Legal** (không dùng hằng số hardcode như FE demo).

Với mỗi công thức, bạn phải cung cấp: định nghĩa toán học, ý nghĩa từng biến, cách hiệu chuẩn trọng số, ví dụ tính tay, và **cơ chế để Legal điều chỉnh trọng số qua cấu hình** thay vì sửa code.

### 7.5. Fallback rule-based (B4)

Thiết kế cụ thể: khi vLLM timeout/lỗi/hết GPU → chạy tầng rule-based đơn thuần (keywords + patterns + kiểm tra field bắt buộc rỗng), đánh dấu `ai_runs.is_fallback = true`, hạ `aiConfidenceScore` theo quy tắc rõ ràng, hiển thị banner cảnh báo cho user. Nêu rõ fallback **không** sinh proposal thay thế văn bản, chỉ cảnh báo.

### 7.6. Chống prompt injection

`_shared/injection_guard.md` đã có và được prepend mọi stage. Nhưng prompt-level là chưa đủ. Bạn phải bổ sung phòng thủ ở tầng kiến trúc:

- Bọc mọi nội dung không tin cậy (văn bản HĐ, chat user) trong delimiter rõ ràng và nêu tường minh đây là **dữ liệu**.
- Detector riêng (rule + classifier nhẹ) chạy trước, phát hiện → gắn Red Flag + ghi audit (theo B6: gắn cờ và tiếp tục review, không dừng hẳn).
- **Phòng thủ thực chất nằm ở output, không phải input:** dù LLM có bị lừa, allow-list Lớp 1 ở tầng ghi file vẫn chặn mọi ghi vào vùng khoá. Hãy nhấn mạnh điểm này trong thiết kế.

### 7.7. Đánh giá chất lượng (B3)

Thiết kế **golden set**: bao nhiêu hợp đồng, ai gán nhãn (Legal), nhãn gồm gì (clause × verdict kỳ vọng), quy trình gán nhãn, cách versioning bộ nhãn.

Metric: precision/recall/F1 **theo từng clause** và theo mức severity; đặc biệt phải đo **recall của nhóm Red Flag / Block** (bỏ sót điều khoản nghiêm trọng là rủi ro R1 mức Cao — thà báo thừa còn hơn bỏ sót). Đề xuất ngưỡng nghiệm thu cụ thể để đưa PM chốt, và cơ chế regression test tự động chạy lại golden set mỗi khi đổi prompt hoặc đổi model.

---

## 8. WORD ENGINE — QUYẾT ĐỊNH KỸ THUẬT LỚN NHẤT (câu hỏi đang mở của chủ dự án)

### Bài toán

Cần một cách để **hiển thị và chỉnh sửa `.docx` trên UI với trải nghiệm gần Word**, đồng thời backend phải thao tác được trên **cùng một mô hình tài liệu**. Yêu cầu cụ thể:

| # | Yêu cầu | Phục vụ |
|---|---------|---------|
| R-a | Render `.docx` đúng format (bảng, header/footer, phân trang, numbering) | Preview mọi màn |
| R-b | Chỉ cho sửa **vùng mở**, khoá cứng phần còn lại | PT2, ràng buộc C-3 |
| R-c | **Comment theo đoạn/field**, thread 2 chiều, tương thích `w:comment` của Word | TH1, PA-B |
| R-d | **Track Changes** tương thích Word, accept/reject từng mục, **tách lớp** với diff AI | TH2, diff AI |
| R-e | API **server-side (headless)** để backend ghi đề xuất AI vào tài liệu | Stage 6 write-back |
| R-f | Đọc/ghi được **Content Control + lock mode** (`w:lock`) | Mô hình vùng mở/khoá |
| R-g | Chèn được run mực trắng tại vị trí kéo-thả | Marker eContract |
| R-h | **Self-hosted 100%**, không gửi tài liệu ra ngoài | Ràng buộc C-1 |

### Các ứng viên đã khảo sát

**1. SuperDoc** (`superdoc.dev`, AGPLv3 hoặc commercial license) — **ứng viên mạnh nhất, khuyến nghị PoC trước tiên.**

- Editor `.docx` native chạy trong browser, dựng trên ProseMirror + Yjs; component cho React (khớp Next.js hiện tại).
- Có **Document API** thống nhất (`editor.doc`, 300+ operation) chạy được ở **cả browser, Node SDK, Python SDK và CLI** → nghĩa là **FE và BE dùng chung một mô hình tài liệu và cùng một bộ API**. Đây là lợi thế lớn nhất: không phải duy trì hai implementation OOXML lệch nhau.
- Hỗ trợ **Content Control (`w:sdt`) với đúng 4 lock mode của OOXML**: `unlocked` / `sdtLocked` / `contentLocked` / `sdtContentLocked`. Ghi vào control đang `contentLocked` bị trả lỗi `LOCK_VIOLATION` — khớp chính xác mô hình vùng khoá của dự án (R-b, R-f).
- Hỗ trợ **tracked changes** (`trackChanges.list()`, `decide({accept|reject})`) và **comments** (`comments.create/list`) ghi vào `.docx` — phục vụ trực tiếp TH1/TH2 và PA-B (R-c, R-d).
- Có sẵn pattern **AI redlining** cả client và server-side — đúng use case của dự án (R-e).
- Chạy hoàn toàn self-hosted (R-h).
- **Rủi ro cần PoC làm rõ — đã cập nhật theo khảo sát template thật (mục 2.3):**
  1. **CÂU HỎI SỐ 1: có hỗ trợ `w:permStart`/`w:permEnd` không?** Template thật dùng **thuần Range Permission, không có một Content Control nào** (F1). Nghĩa là toàn bộ ưu thế "lock mode content control" của SuperDoc **không dùng được trực tiếp**. Nếu engine không hiểu perm range, có ba đường: (a) xử lý perm bằng `lxml` bên ngoài engine; (b) auto-wrap perm range thành Content Control lúc đăng ký template và giữ nguyên perm bên trong (F2 — đề xuất mạnh, cần kiểm chứng không phá Restrict Editing); (c) đề nghị Legal soạn lại template bằng Content Control.
  2. **Ghi được vào vùng mở bắc qua ranh giới bảng không?** 2/16 vùng thật rơi vào ca này, một vùng trải 40 paragraph xuyên nhiều cell (F4). Đây là ca khó nhất, phải test trực tiếp.
  3. **Có resolve được numbering không?** Số điều khoản do Word sinh từ style + `numbering.xml`, không có trong text (F5). Nếu engine trả text đã kèm số điều thì tiết kiệm được một khối lượng công việc lớn.
  4. **`w:permStart` id có ổn định qua round-trip Word không** (mở bằng Word rồi lưu lại — chính là kịch bản PT3)? Nếu Word sinh lại id thì mapping template vỡ.
  5. **Python SDK có đủ tính năng ngang Node SDK không** — backend đã chốt Python (mục 6.1). Nếu thiếu, dùng document-engine sidecar bằng Node.
  6. Độ trung thực round-trip: mở rồi lưu lại không đổi format, mở bằng Microsoft Word đọc đúng comment/track changes.
  7. License — xem phân tích ngay dưới.

  **Dùng chính file `HOP DONG MUA XE VAN - VINH TƯƠNG (FN Review) (003) (1).docx` làm ca test PoC** — nó chứa đủ mọi ca khó: vùng rỗng, vùng 2 ký tự, vùng 3.174 ký tự, vùng bắc qua bảng, comment sẵn có, numbering tự động, và một lỗi số ↔ chữ có thật.

**2. ONLYOFFICE Docs** (Document Server, AGPLv3 / Enterprise) — ứng viên an toàn, "chắc tay".

- Độ trung thực OOXML tốt nhất nhóm open-source, UI gần Microsoft Word nhất → user Purchasing/Legal quen ngay.
- Đủ track changes, comments, content control, version history.
- **Nhược điểm với dự án này:** là một **ứng dụng nhúng qua iframe**, không phải component. Tích hợp qua JS API/WOPI, kiểm soát chi tiết (khoá đúng vùng, tách lớp diff AI vs diff Legal, gán marker kéo-thả) khó và gò bó hơn nhiều. Backend vẫn phải tự làm OOXML riêng → **hai implementation song song**. Hạ tầng nặng hơn (container riêng).

**3. Collabora Online** — nền LibreOffice, fidelity rất tốt với định dạng lạ, nhưng UI khác Word, nặng RAM, tích hợp sâu còn khó hơn ONLYOFFICE. Ứng viên dự phòng.

**4. Syncfusion Document Editor** — component thương mại, feature đầy đủ, hỗ trợ tốt; nhưng license thương mại và mô hình dữ liệu riêng (SFDT) làm phát sinh vòng chuyển đổi docx↔sfdt, rủi ro mất trung thực format.

**5. Tự làm hoàn toàn bằng `lxml` + `docx-preview`** (hướng FE demo đang đi) — kiểm soát tuyệt đối, không phụ thuộc license, nhưng phải tự viết comment, track changes, editor. **Không khả thi trong tiến độ tháng 9/10.**

### Ghi chú về license AGPLv3 (áp dụng cho cả SuperDoc và ONLYOFFICE)

Ứng dụng này **chỉ dùng nội bộ, không phân phối ra ngoài công ty**. Phân tích:

- AGPL **không** buộc public source ra Internet. Nghĩa vụ theo Section 13 là: ai tương tác với ứng dụng qua mạng có quyền yêu cầu nhận source của phiên bản đang chạy. Ở đây "ai" chính là nhân viên nội bộ → chỉ cần sẵn sàng cung cấp source cho nhân viên khi được yêu cầu. Thực tế gần như vô hại.
- Điểm cần lưu ý thật sự là **phạm vi copyleft**: nhúng thư viện AGPL tạo thành combined work, nên về lý thuyết toàn bộ code BE/FE bị kéo vào nghĩa vụ AGPL đối với nhóm user nội bộ đó. Với SuperDoc, phần editor còn được gửi xuống chạy trong browser của user, làm lập luận này mạnh thêm.
- Hai rủi ro thực tế cần nêu trong tài liệu: (1) nếu sau này công ty muốn chuyển giao / bán sản phẩm cho đơn vị khác trong tập đoàn thì vướng; (2) nhiều tập đoàn lớn có OSS policy **cấm thẳng AGPL** bất kể use case.

**Hướng xử lý:** tiến hành PoC với bản AGPL ngay (không chờ), song song gửi câu hỏi cho IT governance / bộ phận pháp chế của công ty, và **dự phòng ngân sách commercial license** làm phương án lùi. Bạn hãy đưa mục này vào phần rủi ro và phần chi phí của Technical Solution, kèm ước tính tác động nếu buộc phải đổi sang phương án non-AGPL.

### Việc bạn phải làm ở mục này

1. Ra **khuyến nghị dứt khoát** kèm bảng so sánh chấm điểm theo R-a…R-h.
2. Thiết kế **kế hoạch PoC có tiêu chí pass/fail rõ ràng**, chạy trên **template hợp đồng khung thật** của công ty, tối đa 1–2 tuần, làm **cổng chặn (gate)** trước khi cam kết kiến trúc. Tối thiểu PoC phải trả lời: round-trip `.docx` có mất format không; `permStart`/`permEnd` có sống sót không; ghi vào vùng khoá có bị chặn thật không; comment/track changes mở bằng Microsoft Word có đọc được không; chèn marker mực trắng rồi FPT có nhận không.
3. Đề xuất **kiến trúc chống khoá cứng vào vendor (anti-lock-in)**: định nghĩa một interface `DocumentEngine` nội bộ (`parse`, `getFieldInventory`, `writeField`, `addComment`, `proposeTrackedChange`, `insertMarker`, `export`) để có thể thay engine mà không đụng tầng nghiệp vụ.
4. Nêu rõ **phương án dự phòng cho Phase 1**: nếu editor chưa sẵn sàng, Phase 1 vẫn có thể chạy với **preview read-only + form chỉnh sửa các trường mở** (vì Phase 1 bản chất là điền field vào template). Đây là con đường an toàn để kịp pilot, còn TH1/TH2 (comment + track changes trên UI) là phần cần editor thực sự. Hãy đánh giá phương án cắt scope này.

---

## 9. TÍCH HỢP FPT.eCONTRACT (outbound)

Spec đầy đủ nằm ở `docs/requirements-alignment/07-econtract-integration.md` và `docs/Tài _liệu_API.pdf`.

Tóm tắt: 4 API (login lấy token; khởi tạo HĐ `excall` với file base64 đã chèn marker + parties; lấy lại link ký; huỷ HĐ) + 3 callback (`Recipient_push_info`, `Recipient_finished`, `Flow_finished`). Marker cú pháp `#ds:id r:p_001_r_001 h:100 #`, chèn mực trắng. Bảng mã lỗi validate marker đều code `13`: `isNotExistsMarkerField`, `tooManyMarkerDigitalField`, `wrongFieldWithRole`, `isNotExistsRecipientInfo`, `recipientRoleIsNull`, `isNotExistsIndividual`, `docTypeCodeIsNotExists`, `requestNotContainsRefId`.

Điểm cần thiết kế:

- **Transactional outbox**: Legal approve và việc gọi FPT phải tách nhau; approve commit DB xong mới đẩy job, tránh mất/trùng.
- **Idempotency** theo `refId` (= `review.code`).
- **Token cache + refresh** trước `expTime`.
- **Retry có backoff** + **job đối soát định kỳ** bằng API lấy link ký, phòng callback treo (rủi ro R5).
- **Map mã lỗi FPT → thông báo tiếng Việt** hiển thị lên UI.
- **Validate marker lần 2 ở server** với đúng bộ luật FE đang dùng (`validateMarkers`), không tin client.
- Chưa có credentials môi trường Demo (D1e) → thiết kế **adapter + mock server** để phát triển và test không bị chặn.

---

## 10. FRONTEND (mức vừa đủ)

Giữ Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui. Việc cần làm:

- Gỡ toàn bộ mock `localStorage`, bật `NEXT_PUBLIC_USE_MOCK=false`, nối API thật.
- Thay `docx-preview` bằng engine đã chọn ở mục 8.
- Bỏ autosave, làm cơ chế lưu thủ công + cảnh báo thoát khi chưa lưu (A4c).
- Nâng gán marker từ click-chọn lên **kéo-thả trên preview** (A7).
- Bổ sung UI còn thiếu so với Blueprint: comment thread 2 chiều theo đoạn (TH1), Track Changes của Manager/Legal (TH2), nút reupload PT3 (logic đã có, chưa có UI), PT2 sửa inline.
- Realtime trạng thái queue (SSE hoặc WebSocket thay cho polling giả lập).
- Dọn `legal_lead` khỏi type và luồng.
- Bổ sung optimistic locking (gửi kèm version/ETag khi ghi).

---

## 11. NFR, BẢO MẬT, VẬN HÀNH

Chi tiết ở `docs/requirements-alignment/05-nfr-and-risks.md`. Các mốc chính:

- **Hiệu năng:** ≥50 HĐ/ngày lúc đỉnh; ≤10 phút/HĐ cho AI review; ≤30s/lượt chat; ≤2s cho thao tác UI thường.
- **Bảo mật:** không cloud AI; RBAC enforce server-side; allow-list Lớp 1 ở tầng ghi file; file mã hoá at-rest, không có public path; audit append-only.
- **Độ tin cậy:** fallback rule-based khi LLM lỗi; queue persistent qua restart; version history khôi phục được.

Bạn phải bổ sung phần Blueprint và NFR chưa nói tới: observability (log có `trace_id` xuyên suốt request → job → lần gọi LLM), metrics (thời gian job, tỷ lệ lỗi LLM, độ dài queue, GPU utilization), backup & disaster recovery, quy trình vận hành model (đổi model/prompt thì làm gì với các review đang chạy), và data retention cho hợp đồng.

---

## 12. CÂU HỎI CÒN TREO — ĐƯA GIẢ ĐỊNH LÀM VIỆC CHO TỪNG CÂU

### Đã có câu trả lời (không cần hỏi lại, thiết kế bám theo)

| # | Nội dung | Đã chốt |
|---|----------|---------|
| — | Ngôn ngữ backend | **Python** → FastAPI (mục 6.1) |
| — | Hạ tầng GPU | **2× NVIDIA A100** (cần xác nhận 40GB hay 80GB) (mục 7.1b) |
| — | Nguồn tài liệu Phase 1 | **Instantiate từ template là đường chính; upload là đường phụ có structural binding** (mục 5.1) |
| — | License AGPLv3 | App dùng nội bộ → về nguyên tắc chấp nhận được; vẫn phải xác nhận IT governance và dự phòng commercial license (mục 8) |
| — | **Cơ chế khoá của template** | **Range Permission** (`w:permStart`/`w:permEnd`) + Restrict Editing `readOnly` có password. Không có Content Control, không có Legacy Form Field. Đã khảo sát trên file thật — xem mục 2.3 |

### Còn treo — với mỗi câu: nêu giả định đang dùng, thiết kế theo giả định đó, ghi rõ phần nào phải sửa nếu giả định sai

**Tài liệu Word — ưu tiên cao nhất**

1. **Mẫu đã khảo sát có đại diện cho toàn bộ hợp đồng khung không?** Mới xem 1 file. Cần thêm 2–3 file của các loại HĐ khung khác, chạy `scripts/inspect-template.py` để xác nhận đều dùng Range Permission và không có Legacy Form Field. Giả định làm việc: đại diện được.
2. **Có bản template trắng do Legal ban hành không**, hay Purchasing luôn copy từ hợp đồng cũ? (mục 2.3 F9 — chặn đường instantiate-from-template ở mục 5.1). Giả định: chưa có, cần Legal chuẩn bị.
3. **`w:permStart` id có ổn định qua round-trip Word không?** Kiểm chứng bằng thực nghiệm, không hỏi ai được (mục 2.3 F2).
4. Có bao nhiêu loại hợp đồng khung, mỗi loại khoảng bao nhiêu vùng mở?
5. Mức chấp nhận lệch style khi ghi ra `.docx` — tiêu chí nghiệm thu "giữ format" là gì (C4)?
6. Ai giữ password Restrict Editing của template, quy trình đổi thế nào (C1 nói Legal giữ, chi tiết chưa có)? Backend cần password để ghi file hay không phụ thuộc engine — làm rõ trong PoC.

**Hạ tầng**

7. A100 là bản 40GB hay 80GB?
8. Có Kubernetes hay chỉ Docker Compose? Có sẵn PostgreSQL/Redis/object storage dùng chung không?
9. SSO nội bộ (AD/LDAP/OAuth) hay tài khoản riêng (D2)?

**AI**

10. Đã có bộ hợp đồng mẫu đã gán nhãn (golden set) chưa? Legal có nguồn lực gán nhãn không (B3)? Lưu ý: file đã khảo sát ở mục 2.3 dùng được làm ca đầu tiên ngay.
11. Ngưỡng nghiệm thu precision/recall mong muốn?
12. Số lượng clause trong checklist một loại HĐ khoảng bao nhiêu? — ảnh hưởng trực tiếp số lần gọi LLM/HĐ và capacity.

**Nghiệp vụ còn mờ trong Blueprint**

13. Số vòng reject tối đa? Mỗi lần reject có bắt buộc chạy lại toàn bộ AI review không (A1 bị cắt chữ)?
14. Sau khi submit, trước khi Manager/Legal duyệt, Purchasing còn sửa được không (A2 bị cắt chữ)?
15. Approval Matrix dùng chung hay riêng theo từng loại HĐ (mục 6.4 Rev12 chưa chốt)?
16. Xoá một danh mục Form lists đang được HĐ sử dụng thì xử lý ra sao (Blueprint đẩy sang Tech Design)?
17. **Người duyệt yêu cầu sửa vùng khoá thì đi đường nào?** Khoảng trống nghiệp vụ mới phát hiện từ comment thật (mục 2.3 F6) — Blueprint chưa có câu trả lời.

**eContract**

18. Credentials môi trường Demo của FPT (D1e), `selector` chính thức (D1a), `docTypeCode` (D1b) — khi nào có?
19. FPT nhận `.docx` trực tiếp hay phải convert PDF trước (D1c chưa chốt dứt điểm)?

---

## 13. NHẮC LẠI TRỌNG TÂM

Khi viết Technical Solution, hãy phân bổ công sức theo đúng độ khó và độ rủi ro:

1. **Word engine + OOXML write-back an toàn** (mục 8) — rủi ro cao nhất, chặn nhiều thứ nhất, phải PoC sớm nhất.
2. **AI pipeline + scoring deterministic** (mục 7) — quyết định chất lượng sản phẩm và khả năng bảo vệ kết quả trước Legal.
3. **Structural binding của template** (mục 5.1) — lỗ hổng thiết kế đang tồn tại trong Blueprint, phải vá.
4. **Anchor model cho comment / track changes** (mục 5.3) — quyết định TH1/TH2 có làm được không.
5. Còn lại (CRUD, RBAC, queue, eContract) là công việc kỹ thuật quen thuộc, làm chuẩn chỉnh là được.

Và luôn nhớ ràng buộc bao trùm: **hệ thống này không bao giờ được phép sửa một ký tự nào trong vùng khoá của hợp đồng — kể cả khi LLM bị lừa, kể cả khi frontend bị bypass, kể cả khi user cố tình.** Mọi thiết kế phải chứng minh được điều đó.
