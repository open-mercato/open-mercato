# Agent ("main") container for app-OME-FEAT-001.
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
ARG OM_VERSION=latest
ENV OM_VERSION=${OM_VERSION} \
    OM_EVAL_APP_DIR=/app/eval-app \
    YARN_ENABLE_IMMUTABLE_INSTALLS=0 \
    DATABASE_URL=postgres://postgres:postgres@postgres:5432/open-mercato \
    REDIS_URL=redis://redis:6379 \
    EVENTS_REDIS_URL=redis://redis:6379 \
    CACHE_REDIS_URL=redis://redis:6379 \
    MEILISEARCH_HOST=http://meilisearch:7700

WORKDIR /app

# Scaffold non-interactively (empty preset → builder-ready baseline).
RUN npx --yes create-mercato-app@${OM_VERSION} eval-app \
      --preset empty --skip-agentic-setup --no-init-git

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
