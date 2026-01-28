FROM node:24-alpine AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Install system deps required by optional native modules (Alpine uses apk)
RUN apk add --no-cache python3 make g++ ca-certificates openssl

# Enable Corepack for Yarn
RUN corepack enable

# Copy workspace configuration files
COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./

# Copy all packages and apps (including package.json files for dependency installation)
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Install all dependencies (including devDependencies for build)
# Note: Using plain install because peer dependency warnings cause lockfile changes
RUN yarn install

# Copy other necessary files
COPY newrelic.js ./
COPY jest.config.cjs jest.setup.ts jest.dom.setup.ts ./
COPY eslint.config.mjs ./


# Build the app
RUN yarn build

# Production stage
FROM node:24-alpine AS runner

ARG CONTAINER_PORT=3000

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=${CONTAINER_PORT}

WORKDIR /app

# Install only production system dependencies (Alpine uses apk)
RUN apk add --no-cache ca-certificates openssl

# Enable Corepack for Yarn
RUN corepack enable

# Copy workspace configuration for production install
COPY package.json yarn.lock .yarnrc.yml turbo.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY --from=builder /app/.yarn ./.yarn

# Copy all packages and app metadata for dependency resolution
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/apps/mercato/package.json ./apps/mercato/

# Install only production dependencies
RUN yarn workspaces focus @open-mercato/app --production

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

# Drop root privileges (Alpine uses adduser instead of useradd)
RUN adduser -D -u 1001 omuser \
 && chown -R omuser:omuser /app

USER omuser

EXPOSE ${CONTAINER_PORT}

# Run the app directly instead of using turbo (which is a devDependency)
WORKDIR /app/apps/mercato
CMD ["yarn", "start"]

