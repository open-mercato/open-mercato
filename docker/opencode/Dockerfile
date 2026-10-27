# OpenCode is pre-installed in the base image (docker/opencode/Dockerfile.base,
# built and pushed to a registry — see BASE_IMAGE.md). This image only layers in
# the project's agents, skills, and entrypoint, so app/dev builds need NO network
# and cannot hit the OpenCode-installer TLS-proxy failures. Rebuilds are seconds.
#
# Set OPENCODE_BASE_IMAGE to your pushed base tag. The default is a placeholder
# on purpose: it fails loudly if left unset rather than silently pulling the
# wrong image. Override per build with `--build-arg OPENCODE_BASE_IMAGE=...` or
# set the default below to your registry namespace.
ARG OPENCODE_BASE_IMAGE=docker.io/openmercatocom/open-mercato-opencode:1.18.3
FROM ${OPENCODE_BASE_IMAGE}

# The base image already installed OpenCode, created the non-root `opencode`
# user + /home/opencode/.config/opencode, and set WORKDIR. Re-assert them so
# this Dockerfile is readable on its own and safe if the base ever changes.
USER opencode
WORKDIR /home/opencode

# Copy instructions to working directory (OpenCode resolves relative to $CWD)
COPY --chown=opencode:opencode AGENTS.md /home/opencode/AGENTS.md
COPY --chown=opencode:opencode entrypoint.sh /home/opencode/entrypoint.sh

# Bake the generated, file-defined OpenCode agents into the image (prod delivery
# model B). Dev bind-mounts this same dir via docker-compose.*.dev.yml (model A).
COPY --chown=opencode:opencode agents/ /home/opencode/.config/opencode/agents/

# Bake the generated NATIVE OpenCode skill files into the image. Dev bind-mounts
# the same dir. OpenCode lists each skill in the built-in `skill` tool and pulls
# SKILL.md on demand (progressive disclosure).
COPY --chown=opencode:opencode skills/ /home/opencode/.config/opencode/skills/

USER root
RUN chmod +x /home/opencode/entrypoint.sh
USER opencode

EXPOSE 4096

# Use entrypoint to generate config dynamically
ENTRYPOINT ["/home/opencode/entrypoint.sh"]
