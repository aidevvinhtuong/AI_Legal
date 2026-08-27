# `src/lib` — phân tầng

Trước đây đây là một thư mục phẳng 25 mục, không nói được file nào thuộc loại
gì. Giờ chia theo **hướng phụ thuộc**, cùng cách backend đang chia
(`app/domain`, `app/services`, `app/api` — xem `backend/CLAUDE.md` mục 2):

```
api.ts        HTTP client: token, If-Match, 401 → /login, tải file nhị phân
utils.ts      cn() cho Tailwind

auth/         phiên đăng nhập — đọc/ghi, và chính sách idle + trần tuyệt đối
domain/       kiểu dữ liệu + luật nghiệp vụ THUẦN — không gọi mạng, không React
docx/         đọc/so sánh/kiểm tra .docx phía client
services/     gọi REST theo từng nhóm nghiệp vụ
hooks/        React hook
```

## Luật phụ thuộc

```
components / app  →  services  →  api
       ↓               ↓
     hooks          domain          ← không phụ thuộc gì
                       ↑
                     docx
```

`domain/` là trung tâm: nó **không được** import `services/`, `api.ts`, hay
`react`. Nhờ vậy luật nghiệp vụ (`econtract-flow`, `permissions`, `roles`) test
được bằng hàm thuần, không cần giả lập mạng — xem `docx/reupload-validation.test.ts`
và `services/review-flow.test.ts` để thấy hai kiểu test khác nhau.

Chiều ngược lại là bình thường: `services/` import type từ `domain/`.

## Hai file từng mang tên sai

`form-lists-store.ts` và `user-store.ts` **không còn là store** từ khi gỡ tầng
mock `localStorage` — chúng chỉ còn type và helper thuần. Tên cũ nói dối về nội
dung nên đã đổi thành `domain/form-lists.ts` và `domain/users.ts`.

Lưu ý có hai cặp trùng tên cơ sở, cố ý và không nhập nhằng khi đọc đường dẫn:

| Đường dẫn | Là gì |
|---|---|
| `domain/users.ts` | hằng số vai trò, `UserInput`, helper hiển thị tên |
| `services/users.ts` | gọi `/api/v1/users` |
| `domain/form-lists.ts` | kiểu `FormListsState`, `slugId`, helper usage |
| `services/form-lists.ts` | gọi `/api/v1/form-lists` |

## Test nằm ở đâu

Toàn bộ ở `src/test/`, soi gương cây thư mục nguồn:

```
src/test/
├── setup.ts            dọn DOM + localStorage sau mỗi test
├── http-recorder.ts    giả lập fetch, ghi lại request
├── contract/           ràng buộc toàn dự án (endpoint, public assets, phân tầng)
├── lib/                theo đúng đường dẫn trong src/lib
│   ├── auth/session-keepalive.test.ts
│   ├── docx/reupload-validation.test.ts
│   ├── hooks/use-review-status.test.ts
│   └── services/{config,review-flow}.test.ts
└── components/layout/session-guard.test.tsx
```

Trước đây test nằm cạnh file gốc (co-location, quy ước phổ biến của hệ sinh
thái JS). Đã đổi vì **backend Python của cùng đội dùng `backend/tests/`** — hai
nửa dự án nên cùng một thói quen, và cây `src/lib` đọc bằng mắt cũng gọn hơn hẳn
khi không xen kẽ file test.

Đánh đổi đã biết: đổi tên hay di chuyển một module thì phải nhớ di chuyển file
test tương ứng — co-location không có vấn đề đó. Bù lại bằng quy ước đường dẫn
soi gương ở trên: `src/lib/docx/x.ts` ⇄ `src/test/lib/docx/x.test.ts`, lệch là
thấy ngay.
