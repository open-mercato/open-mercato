# Stage 1: Build the Docusaurus static site
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack for Yarn
RUN corepack enable

# Copy workspace configuration files from root
COPY package.json yarn.lock .yarnrc.yml ./

# Copy the docs app package.json
COPY apps/docs/package.json ./apps/docs/

# Install dependencies
RUN yarn workspaces focus open-mercato-docs

# Copy docs source files
COPY apps/docs ./apps/docs

# Build the static site
WORKDIR /app/apps/docs
RUN yarn build

# Stage 2: Serve with lightweight Node server
FROM node:20-alpine AS runner


# Create non-root user
RUN addgroup -g 1001 -S docuser && \
    adduser -S -D -H -u 1001 -s /sbin/nologin -G docuser docuser

WORKDIR /app

# Use the same static file handler as the serve CLI.
RUN npm install --no-save --no-package-lock serve-handler@6.1.8

# Copy built static files
COPY --from=builder /app/apps/docs/build ./build
COPY --from=builder /app/apps/docs/vercel.json /app/apps/docs/legacy-docs.cjs ./

# Set ownership
RUN chown -R docuser:docuser /app

USER docuser

ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/img/open-mercato.svg || exit 1

CMD ["node", "legacy-docs.cjs"]
