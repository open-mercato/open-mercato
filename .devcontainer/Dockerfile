FROM node:24-alpine

# System dependencies for native module compilation + general tooling
RUN apk add --no-cache \
    python3 make g++ \
    ca-certificates openssl \
    git curl bash zsh sudo \
    postgresql-client

# Allow the default "node" user to run sudo without a password
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node

# Claude Code CLI — install globally, then give node user ownership for auto-updates
RUN npm install -g @anthropic-ai/claude-code@latest \
    && chown -R node:node /usr/local/lib/node_modules /usr/local/bin

# Enable Corepack and activate the Yarn version used by the project.
# Keep in sync with "packageManager" in the root package.json.
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Default to non-root user
USER node
