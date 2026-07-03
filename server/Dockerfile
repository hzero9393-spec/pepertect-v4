FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY server/package.json server/tsconfig.json ./
COPY server/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

# Prisma generate
FROM deps AS prisma
COPY prisma/ /app/prisma/
COPY server/package.json ./
RUN npx prisma generate --schema=/app/prisma/schema.prisma

# Build TypeScript
FROM prisma AS builder
COPY server/src/ ./src/
COPY server/tsconfig.json ./
RUN npx tsc

# Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/prisma/ ./prisma/

EXPOSE 4000
CMD ["node", "dist/index.js"]