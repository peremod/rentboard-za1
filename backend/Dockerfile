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
# --omit=dev, and --ignore-scripts deliberately.
#
# This stage installs production dependencies only, and package.json has a
# `postinstall: prisma generate` for the benefit of a developer's checkout.
# `prisma` is the CLI and it is a devDependency, so in this stage it does not
# exist: the script fails with `prisma: not found`, npm exits 127, and the
# image never builds. That happened — v1.62.0 added the postinstall, the build
# broke here, and Render went on quietly serving v1.61.0 for five releases
# while CI stayed green, because nothing in CI built this file.
#
# This stage needs no lifecycle scripts at all. The generated Prisma client is
# copied from the builder on the next line, and bcrypt (the only production
# dependency with a native component) ships prebuilt binaries — verified by
# installing it with --ignore-scripts and round-tripping a hash.
#
# --only=production is also deprecated; --omit=dev is the current spelling.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
USER nestjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"
CMD ["node", "dist/main"]
