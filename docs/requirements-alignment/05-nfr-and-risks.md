# 05 — Yêu cầu phi chức năng (NFR) & Risk Register

> Owner: PM · Input: mục "Rủi ro chính" README + phát hiện khi review code demo
> NFR nào chưa có con số thì phải chốt số trong Workshop (tham chiếu câu hỏi mở tương ứng).

## 1. Yêu cầu phi chức năng

### 1.1. Hiệu năng & tải

| ID | Yêu cầu | Chỉ tiêu đề xuất (chốt tại workshop) |
|----|---------|--------------------------------------|
| NFR-P1 | Thông lượng queue AI | Vài trăm HĐ/tháng, dồn cuối tháng/quý — đề xuất chịu được ≥ 50 HĐ/ngày đỉnh `[A8]` |
| NFR-P2 | Thời gian AI review 1 HĐ | Đề xuất ≤ 10 phút/HĐ trên LLM local `[B1, A8]` |
| NFR-P3 | Phản hồi chat edit | Đề xuất ≤ 30s/lượt |
| NFR-P4 | UI thao tác thường (mở danh sách, mở workspace) | ≤ 2s |

### 1.2. Bảo mật & tuân thủ

| ID | Yêu cầu |
|----|---------|
| NFR-S1 | Toàn bộ dữ liệu HĐ và inference LLM ở hạ tầng nội bộ — **không gọi cloud AI** (ràng buộc cứng từ README) |
| NFR-S2 | RBAC enforce **server-side**: Purchasing chỉ truy cập HĐ của mình `[A5]`; Legal inbox chặn role khác (demo mới chặn client, có lỗ hổng toast-only) |
| NFR-S3 | Write-back allow-list Lớp 1 tại tầng ghi file backend — diff ngoài allow-list bị bỏ, kể cả khi FE bị vượt qua |
| NFR-S4 | Prompt injection guard bắt buộc ở mọi stage LLM; phát hiện → Red Flag `[B6]` |
| NFR-S5 | File HĐ lưu trữ mã hoá at-rest, truy cập qua URL có kiểm soát quyền (không public path như demo `/samples/`) `[D3]` |
| NFR-S6 | Audit log bất biến (append-only) cho: hành động AI, sửa field, quyết định Legal, publish config, sửa prompt `[D7]` |

### 1.3. Độ tin cậy & vận hành

| ID | Yêu cầu |
|----|---------|
| NFR-R1 | LLM lỗi/timeout → fallback rule-based, người dùng được thông báo rõ kết quả là fallback `[B4]` |
| NFR-R2 | Chiều nhận file ký (sFTP/callback) treo → retry có backoff + cơ chế đối soát định kỳ + màn hình theo dõi trạng thái đồng bộ `[D1]` |
| NFR-R3 | Job trong queue không mất khi service restart (persistent queue) `[D5]` |
| NFR-R4 | Giữ format `.docx` đầu ra giống input — có bộ tiêu chí nghiệm thu format `[C4]` |
| NFR-R5 | Version history đầy đủ: mọi vòng review/reupload/approve tạo snapshot khôi phục được |

### 1.4. Khả năng bảo trì

| ID | Yêu cầu |
|----|---------|
| NFR-M1 | Checklist/Matrix do Legal tự vận hành không cần deploy (đã có UI config) — backend phải giữ nguyên khả năng này |
| NFR-M2 | System Prompt quản lý bằng Git, CI validate bắt buộc pass (`scripts/validate-prompts.js`) trước khi merge |
| NFR-M3 | Tách trách nhiệm dữ liệu: checklist (Legal) không nằm trong prompt (IT) — validator đã enforce, giữ nguyên nguyên tắc |

## 2. Risk Register

Thang điểm: Xác suất (P) và Ảnh hưởng (I) 1–5. Mức = P×I: Cao ≥ 15, Trung bình 8–14, Thấp < 8.

| ID | Rủi ro | P | I | Mức | Giảm thiểu | Owner |
|----|--------|---|---|-----|-----------|-------|
| R1 | AI bỏ sót / phát hiện sai điều khoản → Legal tin nhầm | 4 | 5 | Cao | Golden set + ngưỡng nghiệm thu B3; disclaimer; Legal vẫn duyệt cuối | PM/Legal |
| R2 | Chưa có backend + LLM trong khi mốc pilot tháng 10 | 4 | 5 | Cao | Chốt scope/stack ngay Workshop 2 (D4, D6); cân nhắc lùi mốc hoặc cắt scope | PM |
| R3 | Ghi OOXML làm lệch style / vỡ format HĐ | 4 | 4 | Cao | PoC pipeline ghi OOXML **ngay trong giai đoạn này** trên template thật (C4) | DEV |
| R4 | User PT3 (sửa offline) gỡ Restrict Editing / mất `permStart` | 3 | 4 | TB | Logic validate reupload đã có — cần chốt chính sách chặn/override (C5) + mật khẩu template (C1) | BA/Legal |
| R5 | Kênh nhận file ký (sFTP/callback) treo / spec không như giả định demo | 3 | 4 | TB | Lấy spec thật sớm nhất (D1); thiết kế retry + đối soát | DEV |
| R13 | Scope Rev12 lớn hơn demo đáng kể (PT2 inline, comment 2 chiều, Track Changes Legal, save thủ công đều chưa có) | 4 | 4 | Cao | Chốt ưu tiên/tách pha ngay tại A4, A4b, A4c, C6; cập nhật estimate trước sign-off | PM/BA |
| R6 | Nghẽn queue cuối tháng/quý | 3 | 3 | TB | NFR-P1/P2; test tải trước pilot | DEV/TESTER |
| R7 | Checklist & Approval Matrix lỗi thời, không ai cập nhật | 2 | 4 | TB | Legal Sửa+Lưu trực tiếp; gán trách nhiệm Legal định kỳ rà soát | Legal |
| R8 | Prompt injection qua nội dung HĐ / chat | 2 | 4 | TB | Injection guard + test injection trong 06-test-strategy; audit Red Flag | IT |
| R9 | Rò rỉ dữ liệu HĐ (file public path, quyền lỏng như demo) | 2 | 5 | TB | NFR-S2/S5; security review trước pilot | IT |
| R10 | Hiểu nhầm yêu cầu vì demo ≠ sản phẩm (stakeholder tưởng đã xong) | 3 | 3 | TB | Gap analysis 01 công bố rõ phần mock; sign-off scope cuối giai đoạn | PM/BA |
| R11 | HĐ NCC không có vùng mở → không sửa được bằng field-level | 3 | 2 | Thấp | Chốt UX C3 (chat + annotation only) | BA |
| R12 | Marker sai/thiếu khi đẩy Econtract | 2 | 3 | Thấp | Validate 2 lớp (client như demo + server bắt buộc) | DEV |

## 3. Ràng buộc đã xác nhận (constraints)

- LLM chạy local, không cloud.
- Output `.docx` giữ format như input.
- Sprint 1: Legal single-step; Approval Matrix chỉ cảnh báo.
- Kết quả AI chỉ là gợi ý — disclaimer bắt buộc trên UI.
