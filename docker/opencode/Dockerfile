FROM alpine:3.20

# Install dependencies (Alpine uses apk, not affected by Debian mirror issues)
RUN apk add --no-cache curl ca-certificates bash shadow

# Install OpenCode and move to system path
RUN curl -fsSL https://opencode.ai/install | bash && \
    cp /root/.opencode/bin/opencode /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

# Create non-root user
RUN useradd -m -s /bin/bash opencode

# Switch to non-root user
USER opencode
WORKDIR /home/opencode

# Create config directory
RUN mkdir -p /home/opencode/.config/opencode

# Copy instructions (config is generated at runtime by entrypoint)
COPY --chown=opencode:opencode AGENTS.md /home/opencode/.config/opencode/AGENTS.md
COPY --chown=opencode:opencode entrypoint.sh /home/opencode/entrypoint.sh

USER root
RUN chmod +x /home/opencode/entrypoint.sh
USER opencode

EXPOSE 4096

# Use entrypoint to generate config dynamically
ENTRYPOINT ["/home/opencode/entrypoint.sh"]
