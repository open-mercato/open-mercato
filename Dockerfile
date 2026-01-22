FROM node:24-bookworm-slim AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Install system deps required by optional native modules
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Enable Corepack for Yarn
RUN corepack enable

# Copy workspace configuration files
COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY .yarn ./.yarn

# Copy package.json files from all workspaces for better layer caching
# Note: These are explicit (not wildcards) to create separate Docker layers per package.
# This optimizes caching - changes to one package.json won't invalidate others.
# Update this list when adding/removing packages from the monorepo.
COPY apps/mercato/package.json ./apps/mercato/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
COPY packages/cache/package.json ./packages/cache/
COPY packages/queue/package.json ./packages/queue/
COPY packages/events/package.json ./packages/events/
COPY packages/search/package.json ./packages/search/
COPY packages/ai-assistant/package.json ./packages/ai-assistant/
COPY packages/content/package.json ./packages/content/
COPY packages/onboarding/package.json ./packages/onboarding/

# Install all dependencies (including devDependencies for build)
# Note: Using plain install because peer dependency warnings cause lockfile changes
RUN yarn install

# Copy source code for all packages and apps
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Copy other necessary files
COPY newrelic.js ./
COPY jest.config.cjs jest.setup.ts jest.dom.setup.ts ./
COPY eslint.config.mjs ./

# Build packages first
RUN yarn build:packages

# Generate module registry files (required before building the app)
RUN yarn generate

# Build the app
RUN yarn build:app

# Production stage
FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app

# Install only production system dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Enable Corepack for Yarn
RUN corepack enable

# Copy workspace configuration for production install
COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY --from=builder /app/.yarn ./.yarn

# Copy package.json files from all workspaces
# Note: Explicit paths (not wildcards) for optimal Docker layer caching.
COPY --from=builder /app/apps/mercato/package.json ./apps/mercato/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/ui/package.json ./packages/ui/
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/packages/cache/package.json ./packages/cache/
COPY --from=builder /app/packages/queue/package.json ./packages/queue/
COPY --from=builder /app/packages/events/package.json ./packages/events/
COPY --from=builder /app/packages/search/package.json ./packages/search/
COPY --from=builder /app/packages/ai-assistant/package.json ./packages/ai-assistant/
COPY --from=builder /app/packages/content/package.json ./packages/content/
COPY --from=builder /app/packages/onboarding/package.json ./packages/onboarding/

# Install only production dependencies
RUN yarn workspaces focus @open-mercato/app --production

# Copy built artifacts from builder
# Copy built package dist folders
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/generated ./packages/core/generated
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/cli/bin ./packages/cli/bin
COPY --from=builder /app/packages/cache/dist ./packages/cache/dist
COPY --from=builder /app/packages/queue/dist ./packages/queue/dist
COPY --from=builder /app/packages/events/dist ./packages/events/dist
COPY --from=builder /app/packages/search/dist ./packages/search/dist
COPY --from=builder /app/packages/ai-assistant/dist ./packages/ai-assistant/dist
COPY --from=builder /app/packages/content/dist ./packages/content/dist
COPY --from=builder /app/packages/onboarding/dist ./packages/onboarding/dist

# Copy package source files that may be needed at runtime (TypeScript declarations, JSON configs, etc.)
COPY --from=builder /app/packages/shared/src ./packages/shared/src
COPY --from=builder /app/packages/ui/src ./packages/ui/src
COPY --from=builder /app/packages/core/src ./packages/core/src
COPY --from=builder /app/packages/cli/src ./packages/cli/src
COPY --from=builder /app/packages/cache/src ./packages/cache/src
COPY --from=builder /app/packages/queue/src ./packages/queue/src
COPY --from=builder /app/packages/events/src ./packages/events/src
COPY --from=builder /app/packages/search/src ./packages/search/src
COPY --from=builder /app/packages/ai-assistant/src ./packages/ai-assistant/src
COPY --from=builder /app/packages/content/src ./packages/content/src
COPY --from=builder /app/packages/onboarding/src ./packages/onboarding/src

# Copy tsconfig files from packages
COPY --from=builder /app/packages/*/tsconfig*.json ./packages/*/

# Copy built Next.js application
COPY --from=builder /app/apps/mercato/.next ./apps/mercato/.next
COPY --from=builder /app/apps/mercato/public ./apps/mercato/public
COPY --from=builder /app/apps/mercato/next.config.ts ./apps/mercato/
COPY --from=builder /app/apps/mercato/components.json ./apps/mercato/
COPY --from=builder /app/apps/mercato/tsconfig.json ./apps/mercato/
COPY --from=builder /app/apps/mercato/postcss.config.mjs ./apps/mercato/

# Copy generated files and other runtime necessities
COPY --from=builder /app/apps/mercato/.mercato ./apps/mercato/.mercato
COPY --from=builder /app/apps/mercato/src ./apps/mercato/src
COPY --from=builder /app/apps/mercato/types ./apps/mercato/types

# Copy runtime configuration files
COPY --from=builder /app/newrelic.js ./

# Drop root privileges
RUN useradd --create-home --uid 1001 omuser \
 && chown -R omuser:omuser /app

USER omuser

EXPOSE 3000

# Run the app directly instead of using turbo (which is a devDependency)
WORKDIR /app/apps/mercato
CMD ["yarn", "start"]
