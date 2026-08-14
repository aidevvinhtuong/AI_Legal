#!/usr/bin/env bash
# Render toàn bộ docs/diagrams/*.mmd sang PNG (và SVG) bằng mermaid-cli.
#
# Lần đầu chạy sẽ tự cài mermaid-cli + chrome-headless-shell vào $MMDC_HOME.
#
# Usage:
#   bash scripts/build-diagrams.sh            # render tất cả
#   bash scripts/build-diagrams.sh 02 05      # chỉ render diagram có tiền tố 02, 05

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAG="$ROOT/docs/diagrams"
OUT="$DIAG/png"
MMDC_HOME="${MMDC_HOME:-/tmp/mmdc}"
SCALE="${SCALE:-2}"

export PUPPETEER_CACHE_DIR="$MMDC_HOME/.puppeteer"
MMDC="$MMDC_HOME/node_modules/.bin/mmdc"
PPTR_CFG="$MMDC_HOME/puppeteer.json"

mkdir -p "$OUT" "$MMDC_HOME"

if [[ ! -x "$MMDC" ]]; then
  echo "▸ Cài mermaid-cli vào $MMDC_HOME ..."
  npm install --no-save --prefix "$MMDC_HOME" @mermaid-js/mermaid-cli >/dev/null
fi

if [[ ! -d "$PUPPETEER_CACHE_DIR/chrome-headless-shell" ]]; then
  echo "▸ Tải chrome-headless-shell ..."
  (cd "$MMDC_HOME" && npx puppeteer browsers install chrome-headless-shell >/dev/null)
fi

cat > "$PPTR_CFG" <<'JSON'
{ "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] }
JSON

shopt -s nullglob
files=()
if [[ $# -gt 0 ]]; then
  for prefix in "$@"; do files+=("$DIAG/${prefix}"*.mmd); done
else
  files=("$DIAG"/*.mmd)
fi

[[ ${#files[@]} -eq 0 ]] && { echo "Không tìm thấy file .mmd nào."; exit 1; }

ok=0; fail=0
for f in "${files[@]}"; do
  name="$(basename "${f%.mmd}")"
  printf '▸ %-40s' "$name"
  if "$MMDC" -i "$f" -o "$OUT/$name.png" \
        -c "$DIAG/mermaid-config.json" -p "$PPTR_CFG" \
        -b white -s "$SCALE" >/dev/null 2>"$OUT/.err"; then
    size=$(stat -c '%s' "$OUT/$name.png")
    printf 'OK  (%s KB)\n' "$((size / 1024))"
    ok=$((ok + 1))
  else
    printf 'LỖI\n'
    sed 's/^/     /' "$OUT/.err" | head -6
    fail=$((fail + 1))
  fi
done
rm -f "$OUT/.err"

echo
echo "Hoàn tất: $ok thành công, $fail lỗi → $OUT"
