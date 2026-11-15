# OpenCode runtime and Docker configuration

Long-form detail split out of [`packages/ai-assistant/AGENTS.md`](../../packages/ai-assistant/AGENTS.md) to keep that file's instruction chain inside the agent budget (see [`.ai/docs/agent-instructions.md`](agent-instructions.md)). That file keeps the pointers; the procedure lives here.

## Dev modes

The default dev mode is **hybrid**: `yarn infra:up` starts OpenCode plus postgres/redis/meilisearch in containers (`starters/docker/compose.infra.yml`), then `yarn dev` runs the app **and the MCP server** natively on the host. `yarn dev` also provisions the MCP API key into `.mercato/mcp-shared/mcp-api-key`, so no manual MCP startup or key wiring is needed.

The "Running the Stack" section of `packages/ai-assistant/AGENTS.md` covers running the MCP server standalone and the fully containerized (enterprise) stacks.

## Rules for the OpenCode container

When modifying the Docker setup, follow this structure:

```yaml
# starters/docker/compose.infra.yml
services:
  opencode:
    build: ./docker/opencode
    container_name: opencode-mvp
    ports:
      - "4096:4096"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./docker/opencode/opencode.json:/root/.opencode/opencode.json
```

MUST keep port 4096 for OpenCode. MUST mount `opencode.json` to `/root/.opencode/opencode.json`.

## File-defined agents

The orchestrator's file-defined agents (`packages/<pkg>/src/modules/<module>/agents/<id>/`) generate OpenCode agent + skill files into `docker/opencode/{agents,skills}/` (committed). The container loads them from `~/.config/opencode/{agents,skills}/` — in our image the OpenCode user is `opencode`, so the real path is `/home/opencode/.config/opencode/...` (the `/root/.opencode/...` path above for `opencode.json` is stale; the running image is non-root). The dev compose files under `starters/docker/` bind-mount those dirs (`:ro`); CI bakes them via Dockerfile `COPY`. The `OPENCODE_VERSION` build ARG pins the image (verify the installer's pin env var plus the agent-file / `task` / skills contracts against the pinned tag — ASSUMPTION flagged in the phase-0 findings).

Workflow after editing any `agents/<id>/` file: `yarn generate`, then **restart** OpenCode (`docker compose --project-directory . -f starters/docker/compose.infra.yml up -d opencode`) — hot-reload is not guaranteed.

The orchestrator adds three read-only MCP tools (`agent_orchestrator.submit_outcome` / `load_skill` / `run_skill_script`, all gated on `agent_orchestrator.agents.run`) that file agents call. Propose-only rests on the generated read-only `tools` allowlist plus the per-run session-token ACL: the MCP HTTP server does **not** strip `isMutation` tools, so a file agent that declares one is rejected at load. See [`packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`](../../packages/enterprise/src/modules/agent_orchestrator/AGENTS.md).

## Azure as a native adapter

Azure is a **native adapter**, not an OpenAI-compatible preset. It calls the Responses API, which is what carries provider-executed built-ins such as `web_search` — the Chat Completions surface the preset used cannot express them, so `model-native` reported "provider azure has no native web search" regardless of the deployment.

Its native search is Grounding with Bing: billed separately, and Microsoft states the Data Protection Addendum does not cover it, so queries leave the tenant's geo boundary. The `model-native` health row says so.
