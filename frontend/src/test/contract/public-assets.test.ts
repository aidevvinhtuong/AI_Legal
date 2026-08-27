/**
 * `frontend/public/` chỉ được chứa tài sản công khai được.
 *
 * ## Vì sao cần chốt bằng test
 *
 * Mọi thứ trong `public/` được Next phục vụ **không qua bất kỳ lớp kiểm quyền
 * nào** — không token, không session, không log truy cập. Đặt một file vào đó
 * là công bố nó ra toàn bộ mạng nội bộ, và không có gì trong quy trình review
 * code làm việc đó nổi bật lên: nó chỉ là "thêm một file".
 *
 * Chuyện đã xảy ra: `public/samples/` từng chứa 4 template hợp đồng của Legal
 * và 2 tài liệu yêu cầu nội bộ. Chúng vào đó hợp lý ở thời mock (FE cần một
 * `.docx` để render preview), rồi mock bị gỡ mà file thì ở lại — không dòng
 * code nào trỏ tới nữa, nhưng
 * `GET /samples/Template_HDDV_chung_2026.docx` vẫn trả 200 kèm nguyên file.
 * Trái thẳng NFR bảo mật của dự án: *"file mã hoá at-rest, không có public
 * path"*.
 *
 * Template giờ nằm ở `template/` (ngoài đường phục vụ), đưa vào hệ thống qua
 * `POST /api/v1/templates` — có kiểm quyền và có lint vùng mở/khoá.
 *
 * ## Cách nới danh sách
 *
 * Thêm phần mở rộng vào `ALLOWED_EXTENSIONS` chỉ khi loại tệp đó **đúng là**
 * thứ ai cũng được xem: logo, icon, font, ảnh trang trí. Tài liệu nghiệp vụ
 * (`.docx`, `.pdf`, `.xlsx`) thì không bao giờ — chúng phải đi qua endpoint
 * kiểm quyền của backend.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const PUBLIC_DIR = resolve(__dirname, "../../../public");

/** Chỉ những loại tệp mà lộ ra ngoài cũng không sao. */
const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".txt", // robots.txt
  ".xml", // sitemap.xml
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("frontend/public", () => {
  it("không chứa tài liệu nghiệp vụ", () => {
    const offenders = walk(PUBLIC_DIR)
      .filter((f) => !ALLOWED_EXTENSIONS.has(extname(f).toLowerCase()))
      .map((f) => relative(PUBLIC_DIR, f));

    // Thông điệp lỗi phải nói được phải làm gì, vì người gặp nó thường là
    // người vừa thêm file và đang không nghĩ tới chuyện phân quyền.
    expect(
      offenders,
      offenders.length
        ? `Những tệp sau nằm trong public/ nên ai cũng tải được, KHÔNG cần đăng nhập:\n` +
            offenders.map((f) => `  - ${f}`).join("\n") +
            `\n\nTemplate hợp đồng → thư mục "template/" ở gốc repo, đăng ký qua ` +
            `Configurations → Templates.\nTài liệu dự án → "docs/".\n` +
            `Chỉ ảnh/font/icon mới thuộc về public/.`
        : undefined
    ).toEqual([]);
  });
});
