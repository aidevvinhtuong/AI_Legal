# 00 — PM Roadmap: Hướng dẫn điều phối giai đoạn thống nhất yêu cầu

> Dành cho: **Project Manager** · Thời lượng: **10 ngày làm việc (2 tuần)**
> Cách dùng: mỗi ngày mở file này, làm theo checklist, tick ✅ vào cột Trạng thái. Mọi deliverable đã có sẵn bản draft trong thư mục này — việc của đội là **hoàn thiện + chốt**, không viết từ đầu.

## 0. Bản đồ tài liệu (đọc theo thứ tự này)

| File | Vai trò | Ai dùng chính |
|------|---------|----------------|
| `00-pm-roadmap.md` (file này) | Lộ trình + checklist điều phối | PM |
| `01-gap-analysis.md` | Hiện trạng demo vs yêu cầu Rev12 — nền cho mọi thảo luận | Cả đội |
| `02-open-questions.md` | Câu hỏi phải chốt trong 2 workshop | BA dẫn, stakeholder trả lời |
| `03-user-stories.md` | Backlog Sprint 1 + AC | BA soạn, TESTER/DEV review |
| `04-api-contract.md` | Hợp đồng API FE↔BE | DEV |
| `05-nfr-and-risks.md` | NFR + risk register | PM own |
| `06-test-strategy.md` | Chiến lược test | TESTER |
| `07-econtract-integration.md` | Giải pháp tích hợp FPT.eContract + marker ký số (đã đối chiếu tài liệu API chính thức của FPT; FE demo đã code theo spec) | DEV own, BA review |

## 1. Lộ trình 10 ngày — việc từng ngày

### Tuần 1 — Khảo sát & Workshop

| Ngày | Việc | Owner | Đầu ra / tiêu chí xong | Trạng thái |
|------|------|-------|------------------------|------------|
| **N1** | Kick-off nội bộ đội (PM/BA/DEV/TESTER): đọc chung `01-gap-analysis.md`, thống nhất thuật ngữ PT1/PT2/PT3, phân công owner từng doc | PM | Biên bản phân công; cả đội chạy được demo local (`cd frontend && npm run dev`) | ☐ |
| **N1** | Gửi lịch mời Workshop 1 (N4) + Workshop 2 (N5) kèm `02-open-questions.md` cho người tham dự | PM | Lịch được accept; tài liệu gửi trước ≥ 2 ngày | ☐ |
| **N2** | BA + DEV rà lại `01` và `02`: bổ sung câu hỏi còn thiếu, gắn mức ưu tiên (Block-scope / Quan trọng / Nice-to-know) cho từng câu | BA, DEV | `02` có cột ưu tiên; câu Block-scope đưa lên đầu agenda | ☐ |
| **N2** | TESTER bắt đầu việc mục 6 của `06-test-strategy.md`: review AC, lên kế hoạch golden set, xin template `.docx` thật từ Legal | TESTER | Danh sách file template cần xin + đầu mối | ☐ |
| **N3** | Chuẩn bị demo walkthrough cho Workshop 1: kịch bản bấm theo 6 luồng E2E (mục 3 của `06`), dữ liệu mẫu sẵn sàng | BA + DEV | Chạy thử trơn tru 1 lượt, có người ghi biên bản được chỉ định | ☐ |
| **N3** | DEV chuẩn bị nội dung kỹ thuật cho Workshop 2: sơ đồ kiến trúc đề xuất, phương án LLM local, câu hỏi nhóm B/C/D; review `07-econtract-integration.md` và gửi câu hỏi D1a–D1f cho đầu mối FPT (xin credentials môi trường Demo) | DEV | Slide/doc ngắn cho Workshop 2; email đã gửi FPT | ☐ |
| **N4** | **Workshop 1 — Nghiệp vụ** (Legal, Purchasing, PM, BA, TESTER dự thính). Agenda ở mục 2.1 | PM chủ trì, BA dẫn nội dung | Nhóm câu hỏi A + A4x chốt xong hoặc có deadline chốt; biên bản gửi trong ngày | ☐ |
| **N5** | **Workshop 2 — Kỹ thuật** (IT, DEV, PM, BA; Legal dự phần template). Agenda ở mục 2.2 | PM chủ trì, DEV dẫn nội dung | Nhóm B/C/D chốt xong hoặc có deadline; chốt stack backend + đầu mối spec Econtract | ☐ |
| **N5** | Cuối ngày: BA cập nhật cột Quyết định trong `02-open-questions.md`, commit lên Git (PR để có trace) | BA | Mọi câu có 1 trong 3 trạng thái: Đã chốt / Hoãn có chủ đích / Chờ (kèm deadline + người nợ câu trả lời) | ☐ |

### Tuần 2 — Hoàn thiện & Sign-off

| Ngày | Việc | Owner | Đầu ra / tiêu chí xong | Trạng thái |
|------|------|-------|------------------------|------------|
| **N6** | BA cập nhật `03-user-stories.md` theo quyết định workshop: gỡ tag `[phụ thuộc]` đã chốt, thêm/bỏ story nếu scope đổi (đặc biệt nhóm Rev12 mới: PT2 inline, comment 2 chiều, Track Changes — xem R13) | BA | Không còn story nào phụ thuộc câu hỏi chưa có deadline | ☐ |
| **N6–N7** | DEV cập nhật `04-api-contract.md`: bổ sung endpoint theo quyết định (sFTP, comments, legal-edits, matrix CRUD); vẽ ERD sơ bộ từ `types.ts` | DEV | BE + FE cùng review và ký duyệt contract | ☐ |
| **N7** | PM cập nhật `05-nfr-and-risks.md`: điền số chốt cho NFR (P1–P4), cập nhật lại điểm rủi ro sau workshop, đặc biệt R2 (mốc pilot tháng 10) và R13 (scope Rev12) | PM | NFR không còn ô "chốt tại workshop"; risk có owner + action cụ thể | ☐ |
| **N7–N8** | TESTER hoàn thiện `06-test-strategy.md`: chốt công cụ theo stack đã chọn, hoàn thành traceability matrix AC ↔ test case cho story Block | TESTER | Mọi AC của story ưu tiên cao có ≥ 1 test case ID | ☐ |
| **N8** | DEV làm **PoC ghi OOXML giữ format** trên template thật (giảm rủi ro R3 — đây là rủi ro kỹ thuật lớn nhất) | DEV | Kết quả PoC pass/fail ghi vào `05` mục R3; nếu fail → leo thang ngay, ảnh hưởng ước lượng | ☐ |
| **N9** | **Review chéo toàn đội**: mỗi người present doc mình own 15'; đội soát tính nhất quán giữa 01↔06 (thuật ngữ, scope, con số) | PM chủ trì | Danh sách chỉnh sửa cuối; ai nợ gì rõ ràng, sửa xong trong ngày | ☐ |
| **N10** | **Sign-off**: họp với sponsor + Legal Lead + IT lead; trình bản tóm tắt scope Sprint 1 (mẫu ở mục 3); ký xác nhận; freeze scope | PM | Biên bản sign-off có chữ ký/email confirm; tag Git `requirements-baseline-v1` | ☐ |
| **N10** | Lập kế hoạch Sprint 1 (sprint planning) từ backlog đã Ready — chuyển sang giai đoạn xây dựng | PM + cả đội | Sprint backlog + estimate + phân công | ☐ |

## 2. Agenda 2 workshop (PM cầm file này khi chủ trì)

### 2.1. Workshop 1 — Nghiệp vụ (N4, ~3 giờ)

1. (15') PM mở đầu: mục tiêu, quy tắc "demo là prototype, chưa phải sản phẩm" (tránh rủi ro R10 — stakeholder tưởng đã xong).
2. (45') BA demo walkthrough 6 luồng trên demo local — dừng ở mỗi điểm gap đã đánh dấu trong `01`.
3. (75') Chốt câu hỏi nhóm **A** trong `02-open-questions.md`, đi theo thứ tự ưu tiên; thư ký ghi Quyết định trực tiếp vào file.
4. (30') Riêng chủ đề lớn nhất: **scope Structured Feedback Rev12** (A4/A4b/A4c) — làm đủ trong Sprint 1 hay tách pha; quyết định này ảnh hưởng trực tiếp estimate.
5. (15') Tổng kết: đọc lại các quyết định, xác nhận deadline cho câu chưa chốt.

### 2.2. Workshop 2 — Kỹ thuật (N5, ~3 giờ)

1. (15') Tóm tắt quyết định nghiệp vụ hôm trước ảnh hưởng kỹ thuật.
2. (30') DEV trình kiến trúc đề xuất + `04-api-contract.md`.
3. (60') Chốt nhóm **B** (LLM: model, hạ tầng GPU, công thức score, golden set) và nhóm **C** (template, OOXML, PT2/PT3).
4. (45') Chốt nhóm **D** (Econtract API + sFTP, SSO, lưu file, queue, môi trường) — mời đầu mối Econtract nếu được.
5. (30') Rà mốc lộ trình: tháng 9 test / tháng 10 pilot còn khả thi không (rủi ro R2) → nếu không, PM chuẩn bị phương án trình sponsor tại N10.

## 3. Mẫu tóm tắt sign-off (N10)

```
BASELINE YÊU CẦU SPRINT 1 — v1 (ngày ...)

1. Scope Sprint 1: [liệt kê epic/story ID từ 03-user-stories.md]
2. Ngoài scope (đã thống nhất hoãn): [story ID + lý do + pha dự kiến]
3. Quyết định quan trọng: [trích 5-10 quyết định lớn từ 02, ví dụ A4, B1, C5, D1]
4. Ràng buộc: LLM local, giữ format .docx, Legal single-step, disclaimer
5. Rủi ro chấp nhận: [từ 05, các risk không có mitigation trước pilot]
6. Mốc: [lịch đã rà lại tại Workshop 2]
7. Ký xác nhận: Sponsor ___ · Legal Lead ___ · IT Lead ___ · PM ___
```

## 4. Nhịp điều phối hằng ngày của PM

- **Daily 15'** (cả giai đoạn): mỗi người báo (1) việc theo bảng ngày hôm nay, (2) blocker, (3) câu hỏi mở nào mình đang nợ/chờ.
- **Theo dõi nợ quyết định**: mọi câu ở trạng thái "Chờ" trong `02` phải có tên người nợ + deadline — PM nhắc mỗi daily, quá hạn 2 ngày thì leo thang.
- **Không cho scope creep**: yêu cầu mới phát sinh sau Workshop → ghi vào mục "Ngoài scope" của sign-off, không nhét vào Sprint 1.
- **Điều kiện dừng/kéo dài giai đoạn**: nếu đến N8 mà các câu Block-scope (A4x, B1, C4/C5, D1) chưa chốt → PM chủ động dời N10, không sign-off baseline thiếu.

## 5. Definition of Done của cả giai đoạn (checklist cuối)

- ☐ 100% câu hỏi trong `02` có Quyết định hoặc Hoãn-có-chủ-đích.
- ☐ Mọi story trong `03` đạt Definition of Ready (không còn `[phụ thuộc]` treo).
- ☐ `04` được DEV FE + BE ký duyệt.
- ☐ NFR trong `05` có số cụ thể; risk Cao đều có action + owner.
- ☐ PoC ghi OOXML (N8) có kết luận.
- ☐ Traceability AC ↔ test case cho story ưu tiên cao trong `06`.
- ☐ Biên bản sign-off + tag Git `requirements-baseline-v1`.
