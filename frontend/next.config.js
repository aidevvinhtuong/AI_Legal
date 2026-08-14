/** @type {import('next').NextConfig} */
module.exports = {
  output: "standalone",
  reactStrictMode: true,
  /**
   * Proxy sang backend — CHUYỂN TIẾP NGUYÊN VẸN, không dịch đường dẫn.
   *
   * Trình duyệt gọi đúng cái backend phục vụ (`/api/v1/...`). Trước đây proxy
   * tự thêm `/v1`, nên đường dẫn trên DevTools khác đường dẫn thật của BE —
   * và một link do BE sinh ra đã bị thêm `/v1` lần thứ hai thành
   * `/api/v1/v1/...` rồi 404. Giữ một đường dẫn duy nhất thì cả họ lỗi đó
   * không còn chỗ phát sinh.
   */
  async rewrites() {
    const apiUrl = process.env.API_REWRITE_URL || "http://localhost:8010";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};
