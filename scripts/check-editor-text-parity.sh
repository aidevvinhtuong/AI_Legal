#!/usr/bin/env bash
#
# Text của SuperDoc phải khớp CHÍNH XÁC text backend đọc từ OOXML.
#
# Vì sao quan trọng: đề xuất track changes (TH2) gửi lên `before`/`after` là toàn
# văn đoạn, và backend đối chiếu bằng SHA-256 rồi tính offset của mẩu đã đổi để
# biết nó rơi vào vùng mở nào. Lệch một ký tự thì hoặc đề xuất bị từ chối, hoặc
# — tệ hơn — mẩu sửa bị ghi lệch vị trí bên trong vùng mở.
#
# Ca đã bắt được: backend đọc `w:tab` thành "\t", SuperDoc dựng thành node `tab`
# có text rỗng. 16/197 đoạn của template HDDV và 61/230 đoạn của hợp đồng THACO
# lệch vì lý do đó — trong đó có Điều 4 Thanh toán.
#
# CHẠY LẠI MỖI KHI NÂNG CẤP `@harbour-enterprises/superdoc` — đó đúng là lúc quy
# ước dựng node có thể đổi mà không ai nhận ra.
#
#   ./scripts/check-editor-text-parity.sh [file.docx ...]
#
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  FILES=(
    "template/0. Template_HDDV_chung_2026.docx"
    "docs/HOP DONG MUA XE VAN - VINH TƯƠNG (FN Review) (003) (1).docx"
  )
fi

# Phải nằm TRONG /app: node giải `@harbour-enterprises/superdoc` bằng cách đi
# ngược cây thư mục, mà node_modules ở /app/node_modules — để ở /tmp là không thấy.
#
# /app là bind mount của ./frontend nên tệp này hiện luôn trong repo — xoá lúc
# thoát, kể cả khi lỗi, để không ai commit nhầm.
trap 'rm -f frontend/.parity-extract.mjs /tmp/parity.json' EXIT
docker compose cp scripts/editor-parity/extract.mjs frontend:/app/.parity-extract.mjs >/dev/null
docker compose cp scripts/editor-parity/compare.py api:/tmp/compare.py >/dev/null

fail=0
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "bỏ qua (không có tệp): $f"
    continue
  fi
  echo "── $(basename "$f")"
  docker compose cp "$f" frontend:/tmp/parity.docx >/dev/null
  docker compose cp "$f" api:/tmp/parity.docx >/dev/null
  docker compose exec -T frontend node /app/.parity-extract.mjs /tmp/parity.docx >/tmp/parity.json
  docker compose cp /tmp/parity.json api:/tmp/parity.json >/dev/null
  docker compose exec -T api python /tmp/compare.py /tmp/parity.json /tmp/parity.docx || fail=1
  echo
done

if [ "$fail" -ne 0 ]; then
  echo "✗ Có đoạn lệch — TH2 sẽ hỏng trên chính những đoạn đó."
  echo "  Sửa NODE_AS_TEXT trong frontend/src/components/review/superdoc-embed.tsx"
  echo "  cho khớp run_text() trong backend/app/services/document/ooxml.py"
  exit 1
fi
echo "✓ Text hai bên khớp chính xác."
