# AI Assistant Package — Agent Guidelines

## Purpose

Adds AI-powered assistance to Open Mercato via four components:
1. **OpenCode Agent** — Go-based AI backend (Docker, port 4096) processing natural language
2. **MCP HTTP Server** — Exposes tools to OpenCode via HTTP (port 3001)
3. **Code Mode Tools** — 2 meta-tools (`search` + `execute`) where the AI writes JS in a `node:vm` sandbox
4. **Command Palette UI** — Raycast-style frontend (Cmd+K)

## Key Commands

```bash
yarn mcp:dev              # Dev MCP server (API key auth only, for Claude Code / local testing)
yarn mcp:serve            # Production MCP server (API key + session tokens, for web chat)
docker start opencode-mvp # Start OpenCode container
curl http://localhost:3001/health   # MCP health check
curl http://localhost:4096/global/health  # OpenCode health check
curl http://localhost:4096/mcp      # OpenCode → MCP connection status
```

## Adding MCP Tools

```typescript
import { registerMcpTool } from '@open-mercato/ai-assistant'
import { z } from 'zod'

registerMcpTool({
  name: 'mymodule.action',
  description: 'Does something useful',
  inputSchema: z.object({ param: z.string() }),
  requiredFeatures: ['mymodule.view'],
  handler: async (args, ctx) => {
    return { result: 'done' }
  }
}, { moduleId: 'mymodule' })
```

**MUST rules:**
- MUST set `requiredFeatures` for any tool that accesses data — never leave empty
- MUST use zod schemas for `inputSchema` — never raw JSON Schema
- MUST return a serializable object from the handler
- MUST use `moduleId` matching the module's `id` field
- Tool naming: `module.action` (e.g., `customers.search`, `sales.create_order`)

## Architecture Constraints

- MUST NOT bypass MCP — all AI tool access goes through the MCP server layer
- MUST NOT call OpenCode directly from the frontend — route through `POST /api/chat`
- MUST keep MCP server stateless per request — fresh server instance per HTTP request
- MUST emit SSE events in order: `thinking` → `text`/`tool-call`/`tool-result` → `done`
- MUST include `sessionId` in the `done` SSE event for frontend session persistence
- MUST use `host.docker.internal` (not `localhost`) in Docker configs for host communication
- MUST keep port 4096 for OpenCode, port 3001 for MCP server

## Two-Tier Authentication

- **Tier 1 (server):** `x-api-key` header validated against `MCP_SERVER_API_KEY` env var. Grants MCP endpoint access but no user permissions.
- **Tier 2 (user):** `_sessionToken` (format: `sess_{32 hex}`, TTL: 2 hours) injected into every tool call. Resolved via `findApiKeyBySessionToken()` → `rbacService.loadAcl()` → per-tool permission check.
- Dev mode (`mcp:dev`) uses API key only. Production mode (`mcp:serve`) requires both tiers.
- `_sessionToken` is auto-injected into tool schemas by the MCP server and auto-stripped before passing to handlers.
- MUST use `.passthrough()` on converted Zod schemas — without it, `_sessionToken` gets stripped by validation.

## Running the Full Stack

1. Start MCP server: `yarn mcp:dev` (dev) or `yarn mcp:serve` (production)
2. Start OpenCode: `docker start opencode-mvp`
3. Start Next.js: `yarn dev`
4. Verify: open browser → Cmd+K → "What tools do you have?"

OpenCode config lives in `docker/opencode/opencode.json` — mount to `/root/.opencode/opencode.json`.

## Common Tasks

- **Add API endpoint to AI discovery:** Define route with `openApi` export → `yarn modules:prepare` → restart MCP server. The `search` tool reads the OpenAPI spec at runtime.
- **Modify OpenCode config:** Edit `docker/opencode/opencode.json` → `docker-compose build opencode` → `docker-compose up -d opencode`
- **Debug tool calls:** Open Command Palette (Cmd+K) → click "Debug" in footer → inspect tool calls/results live

## Conventions

- Frontend uses phase-based state: `idle` → `routing` → `chatting`/`confirming`/`executing` → `idle`
- Use ref + state pattern for `sessionId` — `useState` alone causes stale closures in callbacks
- Use `handleOpenCodeMessage()` from `opencode-handlers.ts` — never call OpenCode HTTP API directly
- Use `extractTextFromResponse()` to parse response — never manually iterate response arrays
- Legacy files `api-discovery-tools.ts` and `entity-graph-tools.ts` are kept but unused

## Non-Obvious Gotchas

- **Promise.race kills sessions:** Never use `Promise.race` for SSE completion — HTTP resolves before SSE emits `done`. Always await only the SSE event promise.
- **Stale closure on sessionId:** Always use a React ref alongside state for sessionId accessed in callbacks. See `useCommandPalette.ts` for the pattern.
- **Schema passthrough:** When transforming tool schemas for `_sessionToken` injection, the converted Zod schema MUST use `.passthrough()` or the token gets stripped.
- **Sandbox security:** `node:vm` sandbox blocks `fetch`, `require`, `process`, `fs`, `Buffer`. Execution timeout: 30s. API call cap: 50 (mutations: 20).
- **Token injection:** Session token is injected into the first message as a `[SYSTEM: ...]` prefix — do not change the exact phrasing, the AI agent depends on it.

## Key Files

| File | Concern |
|------|---------|
| `lib/codemode-tools.ts` | `search` + `execute` tool definitions, type stub generation |
| `lib/sandbox.ts` | `node:vm` sandbox engine with security restrictions |
| `lib/http-server.ts` | MCP HTTP server, schema transformation, auth, per-tool ACL |
| `lib/opencode-handlers.ts` | Chat request processing, SSE streaming, session management |
| `lib/opencode-client.ts` | OpenCode server client (health, sessions, messages) |
| `lib/tool-registry.ts` | Global tool registration (`registerMcpTool`) |
| `lib/tool-loader.ts` | Tool discovery from modules |
| `lib/api-endpoint-index.ts` | OpenAPI endpoint indexing + raw spec cache |
| `acl.ts` | Permission definitions (feature IDs) |
| `cli.ts` | CLI commands (`mcp:serve`, `mcp:serve-http`) |

## Cross-References

- Root `AGENTS.md` → Task Router → "Adding MCP tools" row
- `packages/core/AGENTS.md` → Module development patterns (tools are registered per-module)
- `packages/events/AGENTS.md` → DOM Event Bridge (SSE events to browser)
