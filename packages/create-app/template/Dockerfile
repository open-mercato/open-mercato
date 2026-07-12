FROM node:24-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal
ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL
# Optional: unset/empty builds fine (realtime collaboration stays disabled at
# runtime); a set value must be a trimmed, non-loopback ws(s):// endpoint.
RUN node -e 'const raw = process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL ?? ""; if (raw === "") { process.exit(0) } let endpoint; try { endpoint = new URL(raw) } catch {} const hostname = (endpoint?.hostname ?? "").replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, ""); const loopback = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1" || hostname === "::" || hostname === "0.0.0.0" || /^127(?:\.|$)/.test(hostname) || /^::ffff:7f[0-9a-f]{2}:/.test(hostname) || hostname === "::ffff:0:0"; if (raw !== raw.trim() || !endpoint || !["ws:", "wss:"].includes(endpoint.protocol) || !hostname || loopback) { console.error("ERROR: NEXT_PUBLIC_DOCUMENTS_COLLAB_URL, when set, must be a trimmed, browser-reachable ws(s) endpoint and cannot use localhost or a loopback address; leave it unset to disable realtime collaboration"); process.exit(1) }'
ENV NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=${NEXT_PUBLIC_DOCUMENTS_COLLAB_URL}

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN if grep -Eq 'http://(localhost|127\\.0\\.0\\.1):' .yarnrc.yml; then \
      sed \
        -e "s#http://localhost:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        -e "s#http://127.0.0.1:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        .yarnrc.yml > .yarnrc.yml.container; \
      if ! grep -Eq '^checksumBehavior:' .yarnrc.yml.container; then \
        printf '\nchecksumBehavior: update\n' >> .yarnrc.yml.container; \
      fi; \
      mv .yarnrc.yml.container .yarnrc.yml; \
    fi
RUN yarn install

COPY . .
RUN yarn generate
RUN NODE_ENV=production yarn build

FROM node:24-alpine AS dev

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN if grep -Eq 'http://(localhost|127\\.0\\.0\\.1):' .yarnrc.yml; then \
      sed \
        -e "s#http://localhost:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        -e "s#http://127.0.0.1:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        .yarnrc.yml > .yarnrc.yml.container; \
      if ! grep -Eq '^checksumBehavior:' .yarnrc.yml.container; then \
        printf '\nchecksumBehavior: update\n' >> .yarnrc.yml.container; \
      fi; \
      mv .yarnrc.yml.container .yarnrc.yml; \
    fi
RUN yarn install

COPY . .

COPY docker/scripts/dev-entrypoint.sh /app/docker/scripts/dev-entrypoint.sh
COPY docker/scripts/init-or-migrate.sh /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/dev-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh

EXPOSE 3000 4101
CMD ["/bin/sh", "/app/docker/scripts/dev-entrypoint.sh"]

FROM node:24-alpine AS runner

ARG CONTAINER_PORT=3000
ARG DOCUMENTS_COLLAB_PORT=4101
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal
# Chromium backs the Documents PDF export (puppeteer-core). Build with
# --build-arg INSTALL_CHROMIUM=0 to skip it; PDF export then returns 503.
ARG INSTALL_CHROMIUM=1

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH \
    PORT=${CONTAINER_PORT} \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

RUN if [ "$INSTALL_CHROMIUM" = "1" ]; then \
      apk add --no-cache ca-certificates chromium openssl; \
    else \
      apk add --no-cache ca-certificates openssl; \
    fi
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN if grep -Eq 'http://(localhost|127\\.0\\.0\\.1):' .yarnrc.yml; then \
      sed \
        -e "s#http://localhost:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        -e "s#http://127.0.0.1:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        .yarnrc.yml > .yarnrc.yml.container; \
      if ! grep -Eq '^checksumBehavior:' .yarnrc.yml.container; then \
        printf '\nchecksumBehavior: update\n' >> .yarnrc.yml.container; \
      fi; \
      mv .yarnrc.yml.container .yarnrc.yml; \
    fi
RUN yarn workspaces focus --all --production

COPY --from=builder /app/.mercato/next ./.mercato/next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/types ./types
COPY --from=builder /app/.mercato ./.mercato
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/components.json ./components.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/scripts ./scripts
COPY docker/scripts/init-or-migrate.sh /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh

RUN adduser -D -u 1001 omuser \
 && chown -R omuser:omuser /app

USER omuser

EXPOSE ${CONTAINER_PORT} ${DOCUMENTS_COLLAB_PORT}
CMD ["yarn", "start"]
