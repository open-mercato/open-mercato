FROM node:24-alpine AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Install system deps required by optional native modules (Alpine uses apk)
RUN apk add --no-cache python3 make g++ ca-certificates openssl

# Enable Corepack for Yarn
RUN corepack enable

# Copy workspace manifests first so dependency installs stay cached across source-only changes.
COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY apps/docs/package.json ./apps/docs/
COPY apps/mercato/package.json ./apps/mercato/
COPY packages/ai-assistant/package.json ./packages/ai-assistant/
COPY packages/cache/package.json ./packages/cache/
COPY packages/channel-gmail/package.json ./packages/channel-gmail/
COPY packages/channel-imap/package.json ./packages/channel-imap/
COPY packages/checkout/package.json ./packages/checkout/
COPY packages/cli/package.json ./packages/cli/
COPY packages/content/package.json ./packages/content/
COPY packages/core/package.json ./packages/core/
COPY packages/create-app/package.json ./packages/create-app/
COPY packages/enterprise/package.json ./packages/enterprise/
COPY packages/events/package.json ./packages/events/
COPY packages/gateway-stripe/package.json ./packages/gateway-stripe/
COPY packages/onboarding/package.json ./packages/onboarding/
COPY packages/queue/package.json ./packages/queue/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY packages/search/package.json ./packages/search/
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage-s3/package.json ./packages/storage-s3/
COPY packages/sync-akeneo/package.json ./packages/sync-akeneo/
COPY packages/ui/package.json ./packages/ui/
COPY packages/webhooks/package.json ./packages/webhooks/
COPY scripts/official-modules-setup.mjs ./scripts/
COPY scripts/lib/official-modules.mjs ./scripts/lib/

# Install all dependencies (including devDependencies for build).
RUN yarn install --immutable

# Copy source files after dependencies are installed.
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Copy other necessary files
COPY newrelic.js ./
COPY jest.config.cjs jest.setup.ts jest.dom.setup.ts ./
COPY eslint.config.mjs ./


# Build the app
# Limit Node.js heap to 4GB and reduce worker count to avoid OOM in constrained Docker environments
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN yarn build

# Dev stage: install + build packages only, no production build; run dev server with watch
FROM node:24-alpine AS dev

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY apps/docs/package.json ./apps/docs/
COPY apps/mercato/package.json ./apps/mercato/
COPY packages/ai-assistant/package.json ./packages/ai-assistant/
COPY packages/cache/package.json ./packages/cache/
COPY packages/channel-gmail/package.json ./packages/channel-gmail/
COPY packages/channel-imap/package.json ./packages/channel-imap/
COPY packages/checkout/package.json ./packages/checkout/
COPY packages/cli/package.json ./packages/cli/
COPY packages/content/package.json ./packages/content/
COPY packages/core/package.json ./packages/core/
COPY packages/create-app/package.json ./packages/create-app/
COPY packages/enterprise/package.json ./packages/enterprise/
COPY packages/events/package.json ./packages/events/
COPY packages/gateway-stripe/package.json ./packages/gateway-stripe/
COPY packages/onboarding/package.json ./packages/onboarding/
COPY packages/queue/package.json ./packages/queue/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY packages/search/package.json ./packages/search/
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage-s3/package.json ./packages/storage-s3/
COPY packages/sync-akeneo/package.json ./packages/sync-akeneo/
COPY packages/ui/package.json ./packages/ui/
COPY packages/webhooks/package.json ./packages/webhooks/
COPY scripts/official-modules-setup.mjs ./scripts/
COPY scripts/lib/official-modules.mjs ./scripts/lib/
RUN yarn install --immutable

COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

COPY newrelic.js ./
COPY jest.config.cjs jest.setup.ts jest.dom.setup.ts ./
COPY eslint.config.mjs ./

RUN yarn build:packages

COPY docker/scripts/dev-entrypoint.sh /app/docker/scripts/dev-entrypoint.sh
COPY docker/scripts/init-or-migrate.sh /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/dev-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh

EXPOSE 3000
CMD ["/bin/sh", "/app/docker/scripts/dev-entrypoint.sh"]

# Production stage
FROM node:24-alpine AS runner

ARG CONTAINER_PORT=3000

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=${CONTAINER_PORT}

WORKDIR /app

# Install only production system dependencies (Alpine uses apk)
# sudo: allows non-root user to chown the Railway-mounted volume at startup
RUN apk add --no-cache ca-certificates openssl sudo

# Enable Corepack for Yarn
RUN corepack enable

# Copy workspace configuration for production install
COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY --from=builder /app/.yarn ./.yarn
COPY --from=builder /app/apps/mercato/package.json ./apps/mercato/
COPY --from=builder /app/packages/ai-assistant/package.json ./packages/ai-assistant/
COPY --from=builder /app/packages/cache/package.json ./packages/cache/
COPY --from=builder /app/packages/channel-gmail/package.json ./packages/channel-gmail/
COPY --from=builder /app/packages/channel-imap/package.json ./packages/channel-imap/
COPY --from=builder /app/packages/checkout/package.json ./packages/checkout/
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/packages/content/package.json ./packages/content/
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/create-app/package.json ./packages/create-app/
COPY --from=builder /app/packages/enterprise/package.json ./packages/enterprise/
COPY --from=builder /app/packages/events/package.json ./packages/events/
COPY --from=builder /app/packages/gateway-stripe/package.json ./packages/gateway-stripe/
COPY --from=builder /app/packages/onboarding/package.json ./packages/onboarding/
COPY --from=builder /app/packages/queue/package.json ./packages/queue/
COPY --from=builder /app/packages/scheduler/package.json ./packages/scheduler/
COPY --from=builder /app/packages/search/package.json ./packages/search/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/storage-s3/package.json ./packages/storage-s3/
COPY --from=builder /app/packages/sync-akeneo/package.json ./packages/sync-akeneo/
COPY --from=builder /app/packages/ui/package.json ./packages/ui/
COPY --from=builder /app/packages/webhooks/package.json ./packages/webhooks/

# Install only production dependencies
RUN yarn workspaces focus @open-mercato/app --production

# Copy workspace sources after production dependencies are installed.
COPY --from=builder /app/packages/ ./packages/

# Copy built Next.js application
COPY --from=builder /app/apps/mercato/.mercato/next ./apps/mercato/.mercato/next
COPY --from=builder /app/apps/mercato/public ./apps/mercato/public
COPY --from=builder /app/apps/mercato/next.config.ts ./apps/mercato/
COPY --from=builder /app/apps/mercato/components.json ./apps/mercato/
COPY --from=builder /app/apps/mercato/tsconfig.json ./apps/mercato/
COPY --from=builder /app/apps/mercato/postcss.config.mjs ./apps/mercato/

# Copy generated files and other runtime necessities
COPY --from=builder /app/apps/mercato/.mercato/generated ./apps/mercato/.mercato/generated
COPY --from=builder /app/apps/mercato/src ./apps/mercato/src
COPY --from=builder /app/apps/mercato/types ./apps/mercato/types

# Copy runtime configuration files
COPY --from=builder /app/newrelic.js ./

# Copy Railway entrypoint script
COPY docker/scripts/railway-entrypoint.sh /app/docker/scripts/railway-entrypoint.sh
COPY docker/scripts/init-or-migrate.sh /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/railway-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh

# Prepare storage directory for Railway volume mount
RUN mkdir -p /app/apps/mercato/storage

# Create non-root user and grant passwordless sudo for chown only
RUN adduser -D -u 1001 omuser \
 && chown -R omuser:omuser /app/apps/mercato/storage \
 && echo "omuser ALL=(root) NOPASSWD: /bin/chown" > /etc/sudoers.d/omuser \
 && chmod 0440 /etc/sudoers.d/omuser

USER omuser

EXPOSE ${CONTAINER_PORT}

WORKDIR /app/apps/mercato
CMD ["yarn", "start"]
