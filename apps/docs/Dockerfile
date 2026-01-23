# Stage 1: Build the Docusaurus static site
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack for Yarn
RUN corepack enable

# Copy workspace configuration files from root
COPY package.json yarn.lock .yarnrc.yml ./

# Copy the docs app package.json
COPY apps/docs/package.json ./apps/docs/

# Install dependencies (only what's needed for docs)
RUN yarn workspaces focus open-mercato-docs

# Copy docs source files
COPY apps/docs ./apps/docs

# Build the static site
WORKDIR /app/apps/docs
RUN yarn build

# Stage 2: Serve with Nginx (Dokploy compatible)
FROM nginx:1.27-alpine AS runner

# Install envsubst for dynamic port configuration
RUN apk add --no-cache gettext

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Add nginx config template
COPY apps/docs/nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy built static files
COPY --from=builder /app/apps/docs/build /usr/share/nginx/html

# Create non-root user for nginx
RUN addgroup -g 1001 -S docuser && \
    adduser -S -D -H -u 1001 -h /var/cache/nginx -s /sbin/nologin -G docuser docuser && \
    chown -R docuser:docuser /var/cache/nginx && \
    chown -R docuser:docuser /var/log/nginx && \
    chown -R docuser:docuser /etc/nginx/conf.d && \
    chown -R docuser:docuser /etc/nginx/templates && \
    touch /var/run/nginx.pid && \
    chown -R docuser:docuser /var/run/nginx.pid && \
    chown -R docuser:docuser /usr/share/nginx/html

# Default port (Dokploy will override via PORT env var)
ENV PORT=3000

USER docuser

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/ || exit 1

# Use shell to substitute PORT env var into nginx config
CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
