# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    GANJOOR_API_BASE_URL=https://api.ganjoor.net \
    ACCOUNTS_API_URL=http://server:8787
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Echolalia mirror is optional at build time; it is mounted at runtime.
RUN mkdir -p data/echolalia public/videos && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GANJOOR_API_BASE_URL=https://api.ganjoor.net \
    ACCOUNTS_API_URL=http://server:8787
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p data/echolalia
USER node
EXPOSE 3000
CMD ["node", "server.js"]
