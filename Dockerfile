FROM node:20-alpine AS base
WORKDIR /app

# Install openssl for Prisma compatibility on alpine
RUN apk add --no-cache openssl

# ─── Install & Build ────────────────────────────────────
FROM base AS build
ARG BUILD_DATE
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src/
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --omit=dev

# ─── Production ──────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma/
COPY --from=build /app/package.json ./

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
