# ── Build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Production stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Run as non-root user (security best practice)
RUN addgroup -S wordcatch && adduser -S wordcatch -G wordcatch

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./

USER wordcatch

EXPOSE 3000

# Secrets are injected via docker-compose / ECS env — never baked into the image (NFR-4)
CMD ["node", "src/index.js"]
