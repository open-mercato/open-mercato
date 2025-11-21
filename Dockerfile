FROM node:20-bookworm-slim AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Install system deps required by optional native modules
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

# Install JS dependencies using Corepack/Yarn with caching
COPY package.json yarn.lock ./
COPY packages ./packages
COPY tsconfig.json ./
COPY next.config.ts ./next.config.ts
COPY components.json ./components.json
RUN corepack enable \
 && yarn install --frozen-lockfile --production=false

# Copy the rest of the workspace
COPY . .

# Build Next.js + internal packages for production usage
RUN yarn build

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app

RUN corepack enable

# Copy built artifacts and workspace
COPY --from=builder /app /app

# Drop root privileges
RUN useradd --create-home --uid 1001 omuser \
 && chown -R omuser:omuser /app

USER omuser

EXPOSE 3000

CMD ["yarn", "start"]
