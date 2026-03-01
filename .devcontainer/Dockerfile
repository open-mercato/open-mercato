FROM node:24-slim

# System dependencies for native module compilation + general tooling
# Using Debian-slim instead of Alpine because Homebrew requires glibc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ruby ruby-dev \
    build-essential \
    ca-certificates openssl \
    git curl bash zsh sudo \
    postgresql-client \
    procps file \
    && rm -rf /var/lib/apt/lists/*

# Allow the default "node" user to run sudo without a password
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node

# Enable Corepack and activate the Yarn version used by the project.
# Keep in sync with "packageManager" in the root package.json.
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Switch to non-root user for Homebrew and Claude Code installation
USER node

# Install Homebrew (Linuxbrew) — non-interactive mode
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Claude Code CLI — native install to ~/.claude/bin/ so auto-updates work without sudo
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Homebrew + Claude Code to all shell profiles
RUN echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> /home/node/.bashrc \
    && echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> /home/node/.profile \
    && echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> /home/node/.zshrc \
    && echo 'export PATH="$HOME/.claude/bin:$PATH"' >> /home/node/.bashrc \
    && echo 'export PATH="$HOME/.claude/bin:$PATH"' >> /home/node/.profile \
    && echo 'export PATH="$HOME/.claude/bin:$PATH"' >> /home/node/.zshrc
