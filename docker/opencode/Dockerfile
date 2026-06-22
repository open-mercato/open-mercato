FROM debian:bookworm-slim
# Pinned OpenCode version. The contract (agent-file frontmatter, per-message
# `agent` selection, native skills, task delegation) is validated against THIS
# tag — do not float to latest. ASSUMPTION-to-verify: the installer's version
# pin env var is `VERSION`; confirm against the chosen release before bumping.
ARG OPENCODE_VERSION=1.1.21

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates bash passwd \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode (pinned) and move to system path
RUN curl -fsSL https://opencode.ai/install | VERSION="${OPENCODE_VERSION}" bash && \
    cp /root/.opencode/bin/opencode /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

# Create non-root user
RUN useradd -m -s /bin/bash opencode

# Switch to non-root user
USER opencode
WORKDIR /home/opencode

# Create config directory
RUN mkdir -p /home/opencode/.config/opencode

# Copy instructions to working directory (OpenCode resolves relative to $CWD)
COPY --chown=opencode:opencode AGENTS.md /home/opencode/AGENTS.md
COPY --chown=opencode:opencode entrypoint.sh /home/opencode/entrypoint.sh

# Bake the generated, file-defined OpenCode agents into the image (prod delivery
# model B). Dev bind-mounts this same dir via docker-compose.*.dev.yml (model A).
# Target the plural `agents/` dir under the non-root opencode user's config home.
COPY --chown=opencode:opencode agents/ /home/opencode/.config/opencode/agents/

USER root
RUN chmod +x /home/opencode/entrypoint.sh
USER opencode

EXPOSE 4096

# Use entrypoint to generate config dynamically
ENTRYPOINT ["/home/opencode/entrypoint.sh"]
