# Agent ("main") container for app-OME-FEAT-001-agentic.
#
# Identical to app-OME-FEAT-001, EXCEPT the scaffold installs the Open Mercato
# agentic harness (`--agents claude-code,codex`) instead of `--skip-agentic-setup`.
# This is the A/B counterpart: it measures the SAME bookmarks-CRUD task WITH the
# in-app skills / AGENTS.md / CLAUDE.md guidance available to the agent, so the two
# tasks together isolate how much the OM developer harness moves agent success.
#
# Bakes a freshly scaffolded Open Mercato standalone app, pinned to the OM release
# under test (OM_VERSION), so the app pre-exists before the agent runs. Network is
# available during `docker build`; the runtime services (postgres/redis/meilisearch)
# are separate compose services and are NOT up at build time — so build-time work is
# limited to scaffold + install + codegen. `yarn build`, `db:migrate`, and tenant
# provisioning happen at runtime (agent + verifier phases), when services are up.
FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl jq \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# OM release under test. CI overrides per release: --build-arg OM_VERSION=X.Y.Z
# Pinned to the first canary that ships the `--agents` flag on create-mercato-app.
ARG OM_VERSION=0.6.6-canary.5643.1.455d21799d
ENV OM_VERSION=${OM_VERSION} \
    OM_EVAL_APP_DIR=/app/eval-app \
    YARN_ENABLE_IMMUTABLE_INSTALLS=0 \
    DATABASE_URL=postgres://postgres:postgres@postgres:5432/open-mercato \
    REDIS_URL=redis://redis:6379 \
    EVENTS_REDIS_URL=redis://redis:6379 \
    CACHE_REDIS_URL=redis://redis:6379 \
    MEILISEARCH_HOST=http://meilisearch:7700

WORKDIR /app

# Cache-bust: the scaffold RUN below has an unchanging command string, so Docker
# would happily reuse a stale layer pinned to whatever "latest" meant when the
# layer was first built. ADD re-downloads the registry manifest for OM_VERSION on
# every build and invalidates subsequent layers exactly when the dist-tag moves
# (a pinned X.Y.Z manifest is immutable, so pinned builds still cache fully).
ADD https://registry.npmjs.org/create-mercato-app/${OM_VERSION} /opt/evals/om-version.json

# Scaffold non-interactively (empty preset → builder-ready baseline), WITH the
# agentic harness for Claude Code + Codex (.claude/, AGENTS.md, CLAUDE.md,
# .ai/skills/ …). `--agents` is the non-interactive equivalent of the setup
# wizard; the harness files are committed into the baseline scaffold below, so
# they are NOT counted as agent edits (only consulted as guidance).
RUN npx --yes create-mercato-app@${OM_VERSION} eval-app \
      --agents claude-code,codex --preset empty --no-init-git

WORKDIR /app/eval-app

# Point the app at the compose service hostnames.
RUN if [ -f .env.example ]; then cp .env.example .env; fi \
  && { \
       echo "DATABASE_URL=${DATABASE_URL}"; \
       echo "REDIS_URL=${REDIS_URL}"; \
       echo "EVENTS_REDIS_URL=${EVENTS_REDIS_URL}"; \
       echo "CACHE_REDIS_URL=${CACHE_REDIS_URL}"; \
       echo "MEILISEARCH_HOST=${MEILISEARCH_HOST}"; \
     } >> .env

# Install deps + initial codegen (no services required).
RUN yarn install
RUN yarn generate && yarn generate

# Edit-guard baseline: commit the scaffold so the agent's diff is measurable, and
# snapshot a content hash manifest of node_modules/@open-mercato for C-REUSE-1.
RUN git init -q \
  && git add -A \
  && git -c user.email=evals@open-mercato.dev -c user.name=evals commit -qm "baseline scaffold @${OM_VERSION}" \
  && mkdir -p /opt/evals \
  && ( cd node_modules && find @open-mercato -type f -print0 \
        | sort -z | xargs -0 sha1sum > /opt/evals/om-packages.sha1 ) \
  && git rev-parse HEAD > /opt/evals/base_commit

# main stays alive; agent + verifier exec into it.
WORKDIR /app/eval-app
CMD ["sleep", "infinity"]
