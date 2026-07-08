FROM node:20-alpine
RUN npm install -g bun && apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bunx prisma generate
RUN bun run build
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
CMD ["npx", "next", "start"]