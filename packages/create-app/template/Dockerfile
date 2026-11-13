# Shared actual runtime stage: corporate trust, supported native clients and private recovery storage.
FROM node:24-alpine AS recovery-tools
WORKDIR /app
COPY docker/README.md docker/cert[s] /tmp/om-certs/
RUN set -eu; \
    mkdir -p /usr/local/share/ca-certificates; \
    for cert in /tmp/om-certs/*.crt /tmp/om-certs/*.pem; do \
        [ -f "$cert" ] || continue; \
        name="$(basename "$cert")"; \
        cp "$cert" "/usr/local/share/ca-certificates/om-extra-${name%.*}.crt"; \
        cat "$cert" >> /etc/ssl/certs/ca-certificates.crt; \
        printf '\n' >> /etc/ssl/certs/ca-certificates.crt; \
    done; \
    rm -rf /tmp/om-certs
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ARG ALPINE_MIRROR=""
RUN [ -z "$ALPINE_MIRROR" ] || sed -i "s|https://dl-cdn.alpinelinux.org|$ALPINE_MIRROR|g" /etc/apk/repositories
ARG POSTGRES_CLIENT_MAJOR=17
COPY docker/scripts/install-postgres-clients.sh /usr/local/libexec/om-install-postgres-clients
RUN sh /usr/local/libexec/om-install-postgres-clients "$POSTGRES_CLIENT_MAJOR" \
 && mkdir -p /var/lib/open-mercato/recovery \
 && printf '%s\n' 'Open Mercato private recovery volume' > /var/lib/open-mercato/recovery/.volume-origin \
 && chmod 0700 /var/lib/open-mercato/recovery \
 && chmod 0600 /var/lib/open-mercato/recovery/.volume-origin \
 && chown -R 1001:1001 /var/lib/open-mercato/recovery
ENV OM_BACKUP_BINARIES_DIR=/usr/libexec/postgresql${POSTGRES_CLIENT_MAJOR} \
    OM_RECOVERY_ROOT=/var/lib/open-mercato/recovery
COPY docker/scripts/recovery-entrypoint.sh /usr/local/bin/om-recovery
RUN chmod 0755 /usr/local/bin/om-recovery

FROM recovery-tools AS builder

# Module registration is generated at build time; keep OSS defaults disabled.
ARG OM_ENABLE_ENTERPRISE_MODULES=false
ARG OM_ENABLE_ENTERPRISE_MODULES_BACKUPS=false
ENV OM_ENABLE_ENTERPRISE_MODULES=${OM_ENABLE_ENTERPRISE_MODULES} \
    OM_ENABLE_ENTERPRISE_MODULES_BACKUPS=${OM_ENABLE_ENTERPRISE_MODULES_BACKUPS}

ENV NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal
ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL
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

FROM recovery-tools AS dev

# Module registration is generated at build time; keep OSS defaults disabled.
ARG OM_ENABLE_ENTERPRISE_MODULES=false
ARG OM_ENABLE_ENTERPRISE_MODULES_BACKUPS=false
ENV OM_ENABLE_ENTERPRISE_MODULES=${OM_ENABLE_ENTERPRISE_MODULES} \
    OM_ENABLE_ENTERPRISE_MODULES_BACKUPS=${OM_ENABLE_ENTERPRISE_MODULES_BACKUPS}

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
COPY scripts/dev-encryption-preflight.mjs /app/docker/scripts/encryption-preflight.mjs
COPY docker/scripts/mcp-entrypoint.sh /app/docker/scripts/mcp-entrypoint.sh
RUN chmod +x /app/docker/scripts/dev-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/mcp-entrypoint.sh

EXPOSE 3000 4101
CMD ["/bin/sh", "/app/docker/scripts/dev-entrypoint.sh"]

FROM recovery-tools AS runner

ARG CONTAINER_PORT=3000
ARG DOCUMENTS_COLLAB_PORT=4101
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal
# Chromium backs the Documents PDF export (puppeteer-core). Build with
# --build-arg INSTALL_CHROMIUM=1 to include it; PDF export otherwise returns 503.
ARG INSTALL_CHROMIUM=0

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
COPY scripts/dev-encryption-preflight.mjs /app/docker/scripts/encryption-preflight.mjs
# Used by the optional `mcp` service (compose profile `agents`).
COPY docker/scripts/mcp-entrypoint.sh /app/docker/scripts/mcp-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/mcp-entrypoint.sh

RUN adduser -D -u 1001 omuser \
 && chown -R omuser:omuser /app

USER omuser

EXPOSE ${CONTAINER_PORT} ${DOCUMENTS_COLLAB_PORT}
CMD ["yarn", "start"]
