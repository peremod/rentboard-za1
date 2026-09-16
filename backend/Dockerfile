# Multi-stage build — small final image, non-root user, health check.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

# Fail here rather than at startup. Without a rootDir, tsc infers the project
# root from every file it compiles, and a single .ts outside src/ shifts the
# output to dist/src/main.js — which only surfaces as 'Cannot find module
# /app/dist/main' after the image has built, pushed and been deployed.
RUN test -f dist/main.js || (echo "Build output missing: expected dist/main.js" && ls -R dist | head -30 && exit 1)

FROM node:22-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
USER nestjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"
CMD ["node", "dist/main"]
