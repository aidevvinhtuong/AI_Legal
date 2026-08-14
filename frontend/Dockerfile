# Frontend Next.js 14 — MỘT Dockerfile, hai đích (giống backend/Dockerfile).
#
#   --target dev   : node_modules nằm trong image, mã nguồn mount từ host,
#                    `next dev` tự nạp lại khi sửa file. Dùng với docker-compose.yml.
#   --target prod  : build sẵn, chạy `output: "standalone"` — image gọn, không
#                    có mã nguồn, không có devDependencies.
#
# LƯU Ý QUAN TRỌNG VỀ BIẾN MÔI TRƯỜNG:
# Next.js **nhúng cứng** mọi biến `NEXT_PUBLIC_*` vào bundle lúc BUILD, không
# phải lúc chạy. Nên bản prod phải nhận chúng qua `ARG`; đặt ở `environment:`
# của compose là vô tác dụng. Biến chỉ dùng phía server (`API_REWRITE_URL`) thì
# ngược lại — đọc lúc chạy, đặt ở `environment:` là đúng.

# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
# libc6-compat: một số native module của Next/SWC cần trên Alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ─────────────────────────────────────────────────────────────────────────────
# Lớp phụ thuộc — tách riêng để cache: đổi mã nguồn không phải cài lại npm
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────────────────────
# DEV — sửa code trên host là trình duyệt tự nạp lại
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Mặc định dùng inotify (nhanh, không tốn CPU). Nếu máy dev dùng filesystem
# không đẩy được sự kiện sang container (thư mục mạng, một số cấu hình WSL/mac)
# thì đặt WATCHPACK_POLLING=true trong .env — chậm hơn nhưng chắc chắn nhận.
ENV WATCHPACK_POLLING=false \
    CHOKIDAR_USEPOLLING=false

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD wget -qO- http://localhost:3001/ >/dev/null 2>&1 || exit 1

# `next dev -p 3001` theo đúng script "dev" trong package.json
CMD ["npm", "run", "dev"]

# ─────────────────────────────────────────────────────────────────────────────
# BUILD — biên dịch bản standalone
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Phải truyền lúc build vì Next nhúng cứng vào bundle (xem ghi chú đầu file)
ARG NEXT_PUBLIC_USE_MOCK=false
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_ECONTRACT_LIVE=false
ENV NEXT_PUBLIC_USE_MOCK=${NEXT_PUBLIC_USE_MOCK} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_ECONTRACT_LIVE=${NEXT_PUBLIC_ECONTRACT_LIVE}

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# PROD — chỉ những gì cần để chạy
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS prod
ENV NODE_ENV=production

RUN addgroup -g 10002 -S nextjs && adduser -u 10002 -S nextjs -G nextjs

# `output: "standalone"` gom sẵn server + đúng những node_modules cần dùng.
# `static` và `public` phải copy riêng — standalone không gộp chúng vào.
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs

ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA} \
      org.opencontainers.image.created=${BUILD_TIME} \
      org.opencontainers.image.title="AI Legal Frontend"

ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -qO- http://localhost:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
