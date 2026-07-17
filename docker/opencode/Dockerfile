FROM debian:bookworm-slim
# Pinned OpenCode version. The contract (agent-file frontmatter, per-message
# `agent` selection, native skills, task delegation) is validated against THIS
# tag — do not float to latest. Verified: the installer accepts the pin both as
# a VERSION env var and a --version flag; either skips its GitHub API lookup.
ARG OPENCODE_VERSION=1.1.21

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates bash passwd \
    && rm -rf /var/lib/apt/lists/*

# Corporate TLS-intercepting proxies re-sign HTTPS with a root CA the host
# trusts but this build does not, breaking the installer download below. Trust
# any PEM dropped into certs/ (the Windows launcher mirrors docker/certs/ here;
# see docker/certs/README.md). No-op when the directory is empty.
# cert[s] is a glob + AGENTS.md an always-present anchor: the COPY then
# succeeds even when certs/ is missing from a partial checkout.
COPY AGENTS.md cert[s] /tmp/om-certs/
RUN set -eu; \
    for cert in /tmp/om-certs/*.crt /tmp/om-certs/*.pem; do \
        [ -f "$cert" ] || continue; \
        name="$(basename "$cert")"; \
        cp "$cert" "/usr/local/share/ca-certificates/om-extra-${name%.*}.crt"; \
    done; \
    update-ca-certificates; \
    rm -rf /tmp/om-certs

# Install OpenCode (pinned) and move to system path. The install can fail
# transiently on shared/corporate networks (rate limits, proxies), and
# `curl | bash` masks download failures as a later `cp` error - so download the
# installer to a file and retry the install up to 3 times.
# A blocking proxy answers with an HTML page and HTTP 200, which curl -f cannot
# reject; feeding that to bash yields `syntax error near unexpected token
# 'newline'` and the retry loop just repeats it. Check the bytes and fail fast
# with the real reason instead.
RUN set -eu; \
    curl -fsSL --retry 3 --retry-delay 5 https://opencode.ai/install -o /tmp/opencode-install.sh; \
    if head -c 512 /tmp/opencode-install.sh | grep -qi '<!doctype\|<html'; then \
        echo "https://opencode.ai/install returned an HTML page instead of a script - a proxy is blocking it. Retrying cannot help; ask IT to allow opencode.ai." >&2; \
        exit 1; \
    fi; \
    attempt=1; \
    until bash /tmp/opencode-install.sh --version "$OPENCODE_VERSION"; do \
        if [ "$attempt" -ge 3 ]; then echo "OpenCode install failed after $attempt attempts" >&2; exit 1; fi; \
        attempt=$((attempt + 1)); \
        echo "OpenCode install failed - retrying (attempt $attempt of 3)..." >&2; \
        sleep 10; \
    done; \
    rm -f /tmp/opencode-install.sh; \
    cp /root/.opencode/bin/opencode /usr/local/bin/opencode; \
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

# Bake the generated NATIVE OpenCode skill files (Phase 3) into the image. Dev
# bind-mounts the same dir. Target the plural `skills/` dir; OpenCode lists each
# skill in the built-in `skill` tool and pulls SKILL.md on demand (progressive
# disclosure). The dir is created above; the COPY is a no-op when no skills exist.
COPY --chown=opencode:opencode skills/ /home/opencode/.config/opencode/skills/

USER root
RUN chmod +x /home/opencode/entrypoint.sh
USER opencode

EXPOSE 4096

# Use entrypoint to generate config dynamically
ENTRYPOINT ["/home/opencode/entrypoint.sh"]
