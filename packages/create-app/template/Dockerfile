FROM node:24-alpine AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install

COPY . .
RUN yarn build

FROM node:24-alpine AS dev

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install

COPY . .

COPY docker/scripts/dev-entrypoint.sh /app/docker/scripts/dev-entrypoint.sh
RUN chmod +x /app/docker/scripts/dev-entrypoint.sh

EXPOSE 3000
CMD ["/bin/sh", "/app/docker/scripts/dev-entrypoint.sh"]

FROM node:24-alpine AS runner

ARG CONTAINER_PORT=3000

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=${CONTAINER_PORT}

WORKDIR /app

RUN apk add --no-cache ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --production=true

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/types ./types
COPY --from=builder /app/.mercato ./.mercato
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/components.json ./components.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN adduser -D -u 1001 omuser \
 && chown -R omuser:omuser /app

USER omuser

EXPOSE ${CONTAINER_PORT}
CMD ["yarn", "start"]
