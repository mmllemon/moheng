FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate && npm run build

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl postgresql-client
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/web/dist ./apps/web/dist
EXPOSE 3001
CMD ["sh", "-c", "cd apps/api && ../../node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js && node dist/src/server.js"]
