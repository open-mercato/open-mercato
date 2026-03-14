# OpenCode fullapp.yml Configuration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure OpenCode in all fullapp compose files (root + create-app templates) to use OpenAI (switchable) and connect to the Open Mercato MCP server.

**Architecture:** The `entrypoint.sh` already supports multi-provider config generation via env vars. We pass the right env vars through docker-compose. The MCP connection requires a shared `MCP_SERVER_API_KEY` between the app service (MCP server) and the opencode service (MCP client). Create-app templates need the `docker/opencode/` directory copied in and the opencode service added.

**Tech Stack:** Docker Compose, OpenCode, MCP

---

## Reference

- **Base pattern:** `docker-compose.yml:9-18` — the opencode service env block to mirror
- **Entrypoint:** `docker/opencode/entrypoint.sh` — reads `OPENCODE_PROVIDER`, `OPENCODE_MODEL`, `MCP_SERVER_API_KEY`, `OPENCODE_MCP_URL`
- **Provider definitions:** `packages/shared/src/lib/ai/opencode-provider.ts` — `anthropic`, `openai`, `google`

---

### Task 1: Update opencode service in docker-compose.fullapp.yml

**Files:**
- Modify: `docker-compose.fullapp.yml:10-11`

**Step 1: Replace the opencode environment block**

Replace lines 10-11:
```yaml
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

With:
```yaml
    environment:
      # Provider selection (anthropic, openai, google)
      OPENCODE_PROVIDER: ${OPENCODE_PROVIDER:-openai}
      OPENCODE_MODEL: ${OPENCODE_MODEL:-}
      # Provider API keys (set the one matching OPENCODE_PROVIDER)
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_GENERATIVE_AI_API_KEY:-}
      # MCP configuration
      OPENCODE_MCP_URL: ${OPENCODE_MCP_URL:-http://host.docker.internal:3001/mcp}
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY:-}
```

**Step 2: Verify YAML is valid**

Run: `docker compose -f docker-compose.fullapp.yml config --services`
Expected: List of services (opencode, app, postgres, redis, meilisearch)

---

### Task 2: Add MCP_SERVER_API_KEY to app service in docker-compose.fullapp.yml

**Files:**
- Modify: `docker-compose.fullapp.yml` (after OPENAI_API_KEY line in app service)

**Step 1: Add MCP_SERVER_API_KEY after OPENAI_API_KEY**

After line:
```yaml
      OPENAI_API_KEY: ${OPENAI_API_KEY}
```

Add:
```yaml
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY:-}
```

---

### Task 3: Update opencode service in docker-compose.fullapp.dev.yml

**Files:**
- Modify: `docker-compose.fullapp.dev.yml:11-12`

**Step 1: Replace the opencode environment block**

Same replacement as Task 1.

---

### Task 4: Add MCP_SERVER_API_KEY to app service in docker-compose.fullapp.dev.yml

**Files:**
- Modify: `docker-compose.fullapp.dev.yml` (after OPENAI_API_KEY line in app service)

**Step 1: Add MCP_SERVER_API_KEY after OPENAI_API_KEY**

Same as Task 2.

---

### Task 5: Copy docker/opencode/ directory to create-app template

**Files:**
- Copy: `docker/opencode/Dockerfile` → `packages/create-app/template/docker/opencode/Dockerfile`
- Copy: `docker/opencode/entrypoint.sh` → `packages/create-app/template/docker/opencode/entrypoint.sh`
- Copy: `docker/opencode/AGENTS.md` → `packages/create-app/template/docker/opencode/AGENTS.md`
- Copy: `docker/opencode/opencode.jsonc.example` → `packages/create-app/template/docker/opencode/opencode.jsonc.example`

---

### Task 6: Add opencode service to create-app template docker-compose.fullapp.yml

**Files:**
- Modify: `packages/create-app/template/docker-compose.fullapp.yml`

**Step 1: Add opencode service before app service**

Add at the top of the services block (before `app:`):
```yaml
  opencode:
    build:
      context: ./docker/opencode
    image: opencode-mvp
    container_name: mercato-opencode-${DEPLOY_ENV:-local}
    restart: unless-stopped
    environment:
      # Provider selection (anthropic, openai, google)
      OPENCODE_PROVIDER: ${OPENCODE_PROVIDER:-openai}
      OPENCODE_MODEL: ${OPENCODE_MODEL:-}
      # Provider API keys (set the one matching OPENCODE_PROVIDER)
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_GENERATIVE_AI_API_KEY:-}
      # MCP configuration
      OPENCODE_MCP_URL: ${OPENCODE_MCP_URL:-http://host.docker.internal:3001/mcp}
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY:-}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks:
      - mercato-network-fullapp
```

**Step 2: Add MCP_SERVER_API_KEY to app service**

After `OPENAI_API_KEY` line add:
```yaml
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY:-}
```

---

### Task 7: Add opencode service to create-app template docker-compose.fullapp.dev.yml

Same as Task 6 but for `packages/create-app/template/docker-compose.fullapp.dev.yml`.

---

### Task 8: Final verification

**Step 1: Validate all compose files parse correctly**

Run:
```bash
docker compose -f docker-compose.fullapp.yml config --services
docker compose -f docker-compose.fullapp.dev.yml config --services
```
Expected: Both print service lists without errors

**Step 2: Verify create-app template files exist**

Check that `packages/create-app/template/docker/opencode/` contains all 4 files.
