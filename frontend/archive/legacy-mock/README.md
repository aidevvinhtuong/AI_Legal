# Legacy mock — lưu trữ, KHÔNG build, KHÔNG import

Đây là tầng dữ liệu giả của bản FE demo, đã gỡ khỏi mã nguồn khi frontend chuyển
sang gọi backend thật. Giữ lại vì hai lý do:

1. **Tham chiếu hình dạng dữ liệu.** `mock-data.ts` chứa các `ContractReview`
   đầy đủ mọi trạng thái (`draft` → `signed`), tiện để đối chiếu khi viết
   fixture test hoặc kiểm payload backend trả về có thiếu trường nào không.
2. **Dấu vết quyết định.** `contract-insight.ts` giữ công thức scoring heuristic
   cũ — hữu ích để so sánh khi Stage 4 của pipeline AI ra công thức thật
   (CLAUDE.md §7.4).

## Trạng thái

| File | Vốn là | Vì sao gỡ |
|------|--------|-----------|
| `mock-data.ts` | Seed review + users + store `localStorage` | Dữ liệu nghiệp vụ nay do backend cấp |
| `config-mock.ts` | Seed checklist / matrix / signing rules / audit | Nội dung pháp lý hard-code — vi phạm ràng buộc **C-12** |
| `contract-insight.ts` | Scoring heuristic + finding giả | Điểm số phải deterministic và do backend tính (**§7.4**) |
| `document-number.ts` | Bộ đếm số tài liệu trong `localStorage` | Backend cấp số thật (`next_document_number`) |
| `marker-panel.tsx` | Panel gán marker theo danh sách vị trí cố định | Trái quyết định **A7** (kéo-thả trên preview); component đã chết |

## Ràng buộc

- Thư mục này nằm ngoài `src/` và được liệt trong `exclude` của `tsconfig.json`,
  nên **không** được typecheck và **không** vào bundle.
- Các file ở đây import những module đã đổi hoặc đã xoá (`@/lib/mock-data`,
  `@/lib/permissions`…) nên **sẽ không compile**. Đó là chủ ý — chúng là tài
  liệu tham chiếu, không phải mã chạy được.
- Muốn tái sử dụng cho test: chép phần dữ liệu cần dùng sang
  `src/test/fixtures/`, gỡ hết phần đọc/ghi `localStorage`, rồi mới import.
  Đừng nối lại thư mục này vào đường build.
