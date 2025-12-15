FROM node:22-bookworm-slim AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
COPY packages ./packages
COPY tsconfig.json ./
COPY next.config.ts ./next.config.ts
COPY components.json ./components.json

RUN corepack enable \
    && yarn install --frozen-lockfile --production=false

COPY . .

# Build workspace packages first
RUN yarn build:packages || true

# Build Storybook
RUN yarn build-storybook

FROM nginx:alpine

COPY --from=builder /app/storybook-static /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]