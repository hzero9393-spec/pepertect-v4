FROM node:20-alpine AS base
# Install bun and build tools needed for native modules (sharp, pg, etc.)
RUN npm install -g bun && \
    apk add --no-cache libc6-compat python3 make g++ vips-dev

# Install dependencies
FROM base AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

# Build
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Build Next.js
RUN bun run build

# Production image - minimal
FROM node:20-alpine AS runner
WORKDIR /app

# Runtime dependencies for sharp and pg
RUN apk add --no-cache libc6-compat vips

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]