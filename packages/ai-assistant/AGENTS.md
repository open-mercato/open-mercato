# AI Assistant Module - Agent Guidelines

> **IMPORTANT**: Update this file with every major change to this module. When implementing new features, modifying architecture, or changing key interfaces, update the relevant sections to keep guidance accurate for future agents.

## Where to look first

Before editing this module — and especially before writing or reviewing a new agent — read the public framework docs. They are the source of truth and stay in sync with this AGENTS.md by review:

| Topic | Public doc | This file |
|-------|------------|-----------|
| System map, request flow, persistence | [`apps/docs/docs/framework/ai-assistant/architecture.mdx`](../../apps/docs/docs/framework/ai-assistant/architecture.mdx) | "Architecture Constraints" below |
| End-to-end "add a new agent" walkthrough | [`apps/docs/docs/framework/ai-assistant/developer-guide.mdx`](../../apps/docs/docs/framework/ai-assistant/developer-guide.mdx) + [`.ai/skills/create-ai-agent/SKILL.md`](../../.ai/skills/create-ai-agent/SKILL.md) | "How to Add a New AI Agent" below |
| Agent contract reference | [`apps/docs/docs/framework/ai-assistant/agents.mdx`](../../apps/docs/docs/framework/ai-assistant/agents.mdx) | "How to Add an AI Tool Pack" below |
| Record cards + custom inline UI parts | [`apps/docs/docs/framework/ai-assistant/ui-parts.mdx`](../../apps/docs/docs/framework/ai-assistant/ui-parts.mdx) | "Adding UI Parts" below |
| File upload contract | [`apps/docs/docs/framework/ai-assistant/attachments.mdx`](../../apps/docs/docs/framework/ai-assistant/attachments.mdx) | — |
| Mutation approval lifecycle | [`apps/docs/docs/framework/ai-assistant/mutation-approvals.mdx`](../../apps/docs/docs/framework/ai-assistant/mutation-approvals.mdx) | "Workers" / "Events" below |
| Topbar launcher + Cmd/Ctrl+L | [`apps/docs/docs/framework/ai-assistant/launcher.mdx`](../../apps/docs/docs/framework/ai-assistant/launcher.mdx) | — |
| Overrides/extensions — replace, disable, append, or delete tools/prompts/suggestions across modules | [`apps/docs/docs/framework/ai-assistant/overrides.mdx`](../../apps/docs/docs/framework/ai-assistant/overrides.mdx) | "How to Override or Extend Another Module's Agent or Tool" below |
| Tenant prompt + policy overrides | [`apps/docs/docs/framework/ai-assistant/settings.mdx`](../../apps/docs/docs/framework/ai-assistant/settings.mdx) | — |
| Operator-facing user guide | [`apps/docs/docs/user-guide/ai-assistant.mdx`](../../apps/docs/docs/user-guide/ai-assistant.mdx) | — |

If a section in this AGENTS.md disagrees with one of those public docs, treat the public doc as authoritative and open a follow-up to update this file.

## Use This Module To...

- Add AI-powered assistance capabilities to Open Mercato
- Expose module tools to an AI agent via MCP (Model Context Protocol)
- Enable dynamic API discovery so the agent can call any endpoint without hardcoded tools
- Build the Raycast-style Command Palette UI (Cmd+K) for user interaction

Four core components to understand:

1. **OpenCode Agent** — AI backend that processes natural language and executes tools
2. **MCP HTTP Server** — Exposes tools to OpenCode via HTTP on port 3001
3. **Code Mode Tools** — 2 meta-tools (`search` + `execute`) where the AI writes JavaScript that runs in a `node:vm` sandbox
4. **Command Palette UI** — Raycast-style frontend interface

## Common Tasks

### Add a New Tool

1. Import `registerMcpTool` from `@open-mercato/ai-assistant`
2. Define the tool with name, description, input schema, required features, and handler
3. Register it with a `moduleId`
4. Restart the MCP server

```typescript
import { registerMcpTool } from '@open-mercato/ai-assistant'
import { z } from 'zod'

registerMcpTool({
  name: 'mymodule.action',
  description: 'Does something useful',
  inputSchema: z.object({ param: z.string() }),
  requiredFeatures: ['mymodule.view'],
  handler: async (args, ctx) => {
    // Implementation
    return { result: 'done' }
  }
}, { moduleId: 'mymodule' })
```

**MUST rules for tools:**
- MUST set `requiredFeatures` to enforce RBAC — never leave it empty for tools that access data
- MUST use zod schemas for `inputSchema` — never use raw JSON Schema
- MUST return a serializable object from the handler
- MUST use `moduleId` matching the module's `id` field
- Code Mode `api.request()` MUST enforce endpoint-level RBAC before fetch and fail closed for undocumented or featureless mutation endpoints

### Modify OpenCode Configuration

1. Edit `docker/opencode/opencode.json`
2. Rebuild the container: `docker-compose build opencode`
3. Restart: `docker-compose up -d opencode`

### Add New API Endpoints to Discovery

APIs are automatically available via the Code Mode `search` tool (reads the OpenAPI spec at runtime). To add new endpoints:

1. Define the endpoint in your module's route file with an `openApi` export
2. Regenerate the OpenAPI spec (`yarn generate`)
3. Restart the MCP server — the `search` tool's `spec.paths` will include the new endpoint

### Debug Tool Calls

1. Open Command Palette (Cmd+K)
2. Click "Debug" in the footer to toggle the debug panel
3. Inspect tool calls, results, and errors in real time

### Test Session Persistence

1. Open browser console (F12)
2. Open AI Assistant (Cmd+K)
3. Send: "find customer Taylor"
4. Verify console shows `Done event` with a sessionId
5. Send: "find his related companies"
6. Verify: `willContinue: true` and the AI references Taylor correctly

### How to Add a New AI Agent

> **Use the [`create-ai-agent` skill](../../.ai/skills/create-ai-agent/SKILL.md)** for the full step-by-step procedure (file layout, tool pack registration, mutation approval wiring, ACL/setup, generator + cache refresh, `<AiChat>` embedding, standalone vs monorepo differences, and a verification checklist). The summary below stays here for quick reference.

Typed AI agents live in each module's root `ai-agents.ts`. The generator auto-discovers the file and aggregates it into `apps/mercato/.mercato/generated/ai-agents.generated.ts`. Reference implementations: `packages/core/src/modules/customers/ai-agents.ts` and `packages/core/src/modules/catalog/ai-agents.ts`.

1. Create `<module>/ai-agents.ts` and export `aiAgents: AiAgentDefinition[]` (default export optional).
2. Declare the agent with `defineAiAgent({ ... })` from `@open-mercato/ai-assistant`. Required fields: `id`, `moduleId`, `label`, `description`, `systemPrompt`, `allowedTools`. Useful optional fields: `executionMode` (`'chat'` — default — or `'object'`), `defaultModel`, `acceptedMediaTypes`, `requiredFeatures`, `uiParts`, `readOnly`, `mutationPolicy` (`'read-only'` | `'confirm-required'` | `'destructive-confirm-required'`), `maxSteps`, `output` (Zod schema for `'object'` mode), `resolvePageContext`, `keywords`, `suggestions`, `domain`, `dataCapabilities`.
3. Add the feature(s) you list in `requiredFeatures` to the module's `acl.ts` and grant them in `setup.ts` `defaultRoleFeatures`.
4. Put the agent's tool allowlist behind the narrowest set possible. Start from the general-purpose packs (`search.hybrid_search`, `search.get_record_context`, `attachments.list_record_attachments`, `attachments.read_attachment`, `meta.describe_agent`) and add your module's own `defineAiTool`-registered tools.
5. For mutation-capable agents, keep `readOnly: true` + `mutationPolicy: 'read-only'` on the agent and light up writes only via the per-tenant mutation-policy override table (spec Phase 3 WS-C §5.4). The runtime filters out any `isMutation: true` tool when the override is still read-only.
6. Run `yarn generate` so the agent shows up in the registry. Smoke-test via `/backend/config/ai-assistant/playground` (see `/framework/ai-assistant/playground`), then embed `<AiChat agent="<module>.<agent>" />` in the page where you want the operator UI.

### How to Add an AI Tool Pack

Typed tools live under `<module>/ai-tools/` and register via `defineAiTool`. Tool packs are exposed to agents through the agent's `allowedTools` array.

```typescript
import { defineAiTool } from '@open-mercato/ai-assistant'
import { z } from 'zod'

const listPeopleTool = defineAiTool({
  name: 'customers.list_people',
  description: 'Search customer people records by name, email, or tag.',
  inputSchema: z.object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  requiredFeatures: ['customers.people.view'],
  isMutation: false,
  async handler(input, ctx) {
    // ctx.container, ctx.tenantId, ctx.organizationId, ctx.userId, ctx.userFeatures, ctx.isSuperAdmin
    return { records: [] }
  },
})
```

MUST rules:
- MUST set `requiredFeatures` for any tool that reads or writes tenant data. The wildcard-aware ACL matcher is applied before the handler runs.
- MUST use Zod for `inputSchema` — never raw JSON Schema.
- MUST set `isMutation: true` on write tools. The policy gate strips these from read-only agents and from read-only tenant overrides.
- MUST route every mutation tool through `prepareMutation(...)` (see the Mutation Approvals guide at `/framework/ai-assistant/mutation-approvals`). Writing directly inside the handler bypasses the approval gate — the runtime fails closed and refuses to return a result to the operator.
- MUST expose tools to an agent by listing the tool name in the agent's `allowedTools`. Tools not on the whitelist never reach the model.

Run `yarn generate` after adding/changing tool definitions so the typed tool registry picks them up.

### How to Add a UI Part (record cards / custom inline widgets)

UI parts are typed inline widgets the agent streams into the chat. Two paths — pick the cheapest one that fits.

**Path A — record cards (no registration).** Five kinds ship out of the box: `product`, `deal`, `person`, `company`, `activity`. Add a `responseStyle` rule to the agent's prompt teaching the model to emit a fenced Markdown block whose info string is `open-mercato:<kind>` and whose body is one JSON object. The chat composer auto-parses the fence into a typed component. Reference: `packages/core/src/modules/customers/ai-agents.ts` (CRM cards) and `packages/core/src/modules/catalog/ai-agents.ts` (product cards). Card payload shapes live in `packages/ui/src/ai/records/types.ts`.

To add a brand-new record-card kind:

1. Add the payload type + the `RecordCardKind` union in `packages/ui/src/ai/records/types.ts`.
2. Implement the component (copy `ProductCard.tsx` or `PersonCard.tsx`; reuse `RecordCardShell` for header/leading/meta consistency).
3. Wire it into `packages/ui/src/ai/records/registry.tsx` so `RecordCard` resolves the kind.
4. Update the consuming agent's prompt with a fenced example.
5. Add an integration spec asserting `<AiMessageContent>` renders the new kind from a fenced sample.

**Path B — custom server-emitted parts.** For widgets that need server-only state (one-time signed URLs, action handlers, computed snapshots), register a stable namespaced component id and have the tool handler enqueue the part:

```ts
// 1. component
'use client'
import { registerAiUiPart } from '@open-mercato/ui/ai'
registerAiUiPart('<module>:<kind>', YourComponent)

// 2. push from a tool's handler
async handler(args, ctx) {
  ctx.uiParts?.enqueue({ componentId: '<module>:<kind>', props: { /* serializable */ } })
  return { ok: true }
}
```

MUST rules for UI parts:

- MUST use a namespaced component id (`<module>:<kind>`). Reserved ids (`mutation-preview-card`, `field-diff-card`, `confirmation-card`, `mutation-result-card`) are FROZEN; never reuse.
- MUST keep props serializable (no functions, no class instances, no circular refs — the SSE encoder drops them).
- MUST gate any privileged action inside the part behind the same ACL features as the originating tool.
- MUST keep prompt instructions in sync with the tool — without a prompt rule the model will paraphrase instead of emitting the part.

Full reference: `apps/docs/docs/framework/ai-assistant/ui-parts.mdx`.

### How to Override or Extend Another Module's Agent or Tool

Modules can replace/disable any AI agent or AI tool that another module registered, or patch an existing agent by appending, deleting, or replacing allowed tools, system-prompt text, and starter suggestions. Use full overrides when you need to swap the whole behavior; use `aiAgentExtensions` when a downstream module only wants to adjust a shipped agent, such as adding "show catalog stats" while removing an irrelevant starter prompt. See spec `.ai/specs/2026-04-30-ai-overrides-and-module-disable.md` and `apps/docs/docs/framework/ai-assistant/overrides.mdx`.

There are three paths.

**Path A — extra exports on `<module>/ai-agents.ts` / `<module>/ai-tools.ts` (per-module file).** No separate `<module>/ai-overrides.ts` file. The generator already scans the existing `ai-agents.ts` / `ai-tools.ts` files; it now also picks up the optional `aiAgentOverrides` / `aiToolOverrides` exports and emits them as sibling `aiAgentOverrideEntries` / `aiToolOverrideEntries` arrays inside the same generated files.

```ts
// src/modules/<my-module>/ai-agents.ts
import type {
  AiAgentDefinition,
  AiAgentOverridesMap,
} from '@open-mercato/ai-assistant'
import myCustomMerchandisingAgent from './agents/my-merchandising-agent'

export const aiAgents: AiAgentDefinition[] = [
  // ...your module's own agents
]

export const aiAgentOverrides: AiAgentOverridesMap = {
  // Replace the default merchandising assistant with my variant.
  'catalog.merchandising_assistant': myCustomMerchandisingAgent,
  // Disable the default catalog explorer entirely.
  'catalog.catalog_assistant': null,
}
```

Agent extension patch:

```ts
import { defineAiAgentExtension } from '@open-mercato/ai-assistant'

export const aiAgentExtensions = [
  defineAiAgentExtension({
    targetAgentId: 'catalog.catalog_assistant',
    deleteAllowedTools: ['catalog.old_stats'],
    appendAllowedTools: ['example.catalog_stats'],
    appendSystemPrompt: 'Use example.catalog_stats when the operator asks for catalog metrics.',
    deleteSuggestions: ['Old catalog stats'],
    appendSuggestions: [
      { label: 'Show catalog stats', prompt: 'Show catalog stats' },
    ],
  }),
]
```

Extension fields apply in deterministic order: `replace*` first, `delete*` second, `append*` last. Supported fields are `replaceAllowedTools` / `deleteAllowedTools` / `appendAllowedTools`, `replaceSystemPrompt` / `appendSystemPrompt`, and `replaceSuggestions` / `deleteSuggestions` / `appendSuggestions`. The legacy `suggestions` field is still accepted as an append alias.

```ts
// src/modules/<my-module>/ai-tools.ts
import { defineAiTool, type AiToolOverridesMap } from '@open-mercato/ai-assistant'

export const aiTools = [/* ...your module's own tools */]

export const aiToolOverrides: AiToolOverridesMap = {
  'inbox_ops_accept_action': null,
}
```

**Path B — `modules.ts` inline (app-level static, unified `entry.overrides`).** Declare overrides under the umbrella `overrides.ai` key on a `ModuleEntry` inside `apps/<app>/src/modules.ts`. Other contracts a module presents (routes, events, workers, widgets, …) reuse the same `entry.overrides` shape per spec `.ai/specs/2026-05-04-modules-ts-unified-overrides.md` (AI is Phase 1; other domains roll out as separate PRs). The app's `bootstrap.ts` calls `applyModuleOverridesFromEnabledModules(enabledModules)` from `@open-mercato/shared/modules/overrides` once at boot — both `apps/mercato` and the `create-mercato-app` template ship that wiring.

```ts
// apps/<app>/src/modules.ts
{
  id: 'example',
  from: '@app',
  overrides: {
    ai: {
      agents: { 'catalog.catalog_assistant': null },
      tools:  { 'inbox_ops_accept_action': null },
    },
  },
},
```

**Path C — programmatic API (boot-time / dynamic).** Call from `src/bootstrap.ts` or any boot-time entry point. Programmatic overrides supersede both `modules.ts` and file-based overrides for the same id and persist for the process lifetime.

```ts
import {
  applyAiAgentOverrides,
  applyAiToolOverrides,
} from '@open-mercato/ai-assistant'

applyAiAgentOverrides({
  'catalog.catalog_assistant': null, // disable
})
applyAiToolOverrides({
  'inbox_ops_accept_action': null,   // disable a default tool
})
```

MUST rules:

- MUST keep override exports inside the existing `<module>/ai-agents.ts` / `<module>/ai-tools.ts` files (no separate `ai-overrides.ts` file is generated or scanned).
- MUST keep override values consistent with their map key — the value's `id` (agent) or `name` (tool) MUST equal the key. Mismatches log a warning and are skipped.
- MUST NOT use overrides to patch your own module's agent / tool — author the canonical definition in the same `ai-agents.ts` / `ai-tools.ts` `aiAgents` / `aiTools` array instead. The convention is for **cross-module** replacement.
- MUST run `yarn generate` after editing any `aiAgentOverrides` / `aiToolOverrides` export so the generated registry picks the change up.
- MUST run `yarn mercato configs cache structural --all-tenants` after disabling an agent so existing tenants flush stale nav/agent caches.
- MUST call `applyModuleOverridesFromEnabledModules(enabledModules)` from the app's `bootstrap.ts` if you use Path B (already wired in `apps/mercato` and the `create-mercato-app` template). Importing `@open-mercato/ai-assistant` also runs the side-effect that registers the AI domain applier with the dispatcher.

Resolution order (highest precedence first):

1. Programmatic `applyAiAgentOverrides` / `applyAiToolOverrides` calls (last call per id wins).
2. `modules.ts` inline (`aiAgentOverrides` / `aiToolOverrides` on `ModuleEntry`; last entry per id wins).
3. File-based `<module>/ai-agents.ts` / `<module>/ai-tools.ts` overrides (last module load order wins).
4. The base `<module>/ai-agents.ts` / `<module>/ai-tools.ts` registrations.

`null` always means "disable" — applies to all three paths.

### How to Embed the Global Launcher

The topbar AI launcher is mounted in `packages/ui/src/backend/AppShell.tsx`:

```tsx
import { AiAssistantLauncher } from '@open-mercato/ui/ai'
<AiAssistantLauncher variant="topbar" />
```

It self-fetches `/api/ai_assistant/health` and `/api/ai_assistant/ai/agents` and renders nothing when AI is not configured or the caller has access to no agents. It also binds the global **Cmd/Ctrl+L** keyboard shortcut (preventDefault'd against the browser address-bar binding). Standalone apps with custom chrome should mount the same component to expose the global launcher.

Full reference: `apps/docs/docs/framework/ai-assistant/launcher.mdx`.

### How to Configure AI Providers

The unified AI runtime picks the first configured provider from `llmProviderRegistry`. Configure providers via env variables:

| Variable | Provider | Default model |
|----------|----------|---------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o-mini` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google | `gemini-1.5-pro-latest` |

At least one MUST be set or the runtime throws `AiModelFactoryError` with `code: 'no_provider_configured'` on first invocation. See `/framework/ai-assistant/overview` for the full matrix.

Per-module model overrides use `<MODULE>_AI_MODEL` (uppercased from the agent's `moduleId`): for example, `CATALOG_AI_MODEL=claude-opus-4-20250514`, `INBOX_OPS_AI_MODEL=gpt-4o`.

All new callers MUST use `createModelFactory(container)` from `@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory` — never inline provider SDK calls (`createAnthropic`, `createOpenAI`, `createGoogleGenerativeAI`). The factory enforces the resolution order (caller override → `<MODULE>_AI_MODEL` → `agentDefaultModel` → provider default) and throws the documented `AiModelFactoryError` codes when misconfigured. See **Model Resolution** below.

## Architecture Constraints

When modifying this stack, follow these constraints:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI ASSISTANT MODULE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Frontend (Command Palette)                        │    │
│  │  • Raycast-style dialog (Cmd+K)                                     │    │
│  │  • Phase-based navigation (idle → routing → chatting → executing)   │    │
│  │  • "Agent is working..." indicator                                   │    │
│  │  • Debug panel for tool calls                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      POST /api/chat (SSE)                             │    │
│  │  • Receives user message                                             │    │
│  │  • Emits 'thinking' event immediately                                │    │
│  │  • Calls OpenCode → waits for response                               │    │
│  │  • Emits 'text' and 'done' events                                    │    │
│  │  • Maintains session ID for conversation context                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    OpenCode Client                                   │    │
│  │  • handleOpenCodeMessage() - Send message, get response              │    │
│  │  • extractTextFromResponse() - Parse response text                   │    │
│  │  • Session management (create, resume)                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                OpenCode Server (Docker :4096)                        │    │
│  │  • Go-based AI agent in headless mode                                │    │
│  │  • Connects to MCP server for tools                                  │    │
│  │  • Executes multi-step tool workflows                                │    │
│  │  • Uses Anthropic Claude as LLM                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    MCP HTTP Server (:3001)                           │    │
│  │  • Exposes 3 tools: context_whoami + Code Mode (search, execute)    │    │
│  │  • search: AI writes JS to query OpenAPI spec + entity schemas      │    │
│  │  • execute: AI writes JS to make API calls via api.request()        │    │
│  │  • Authentication via x-api-key header                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**MUST rules for architecture changes:**
- MUST NOT bypass the MCP server layer — all AI tool access goes through MCP
- MUST NOT call OpenCode directly from the frontend — always route through `POST /api/chat`
- MUST keep the MCP server stateless per request — create a fresh server instance for each HTTP request
- MUST emit SSE events in order: `thinking` first, then `text`/`tool-call`/`tool-result`, then `done` last
- MUST include `sessionId` in the `done` event so the frontend can persist conversation context

## Directory Structure

```
packages/ai-assistant/
├── src/
│   ├── index.ts                    # Package exports
│   ├── di.ts                       # Dependency injection setup
│   ├── types.ts                    # Shared TypeScript types
│   │
│   ├── modules/ai_assistant/
│   │   ├── index.ts                # Module exports
│   │   ├── acl.ts                  # Permission definitions
│   │   ├── cli.ts                  # CLI commands (mcp:serve, mcp:serve-http)
│   │   ├── di.ts                   # Module DI container
│   │   │
│   │   ├── lib/
│   │   │   ├── opencode-client.ts      # OpenCode server client
│   │   │   ├── opencode-handlers.ts    # Request handlers for OpenCode
│   │   │   ├── codemode-tools.ts       # Code Mode search + execute tools
│   │   │   ├── sandbox.ts             # node:vm sandbox executor
│   │   │   ├── truncate.ts            # Response size limiter
│   │   │   ├── api-endpoint-index.ts   # OpenAPI endpoint indexing + raw spec cache
│   │   │   ├── api-discovery-tools.ts  # (legacy, unused) old find_api/call_api
│   │   │   ├── entity-graph-tools.ts   # (legacy, unused) old discover_schema
│   │   │   ├── http-server.ts          # MCP HTTP server implementation
│   │   │   ├── mcp-server.ts           # MCP stdio server implementation
│   │   │   ├── tool-registry.ts        # Global tool registration
│   │   │   ├── tool-executor.ts        # Tool execution logic
│   │   │   ├── tool-loader.ts          # Discovers tools from modules
│   │   │   ├── mcp-tool-adapter.ts     # Converts MCP tools to AI SDK format
│   │   │   └── types.ts                # Module-specific types
│   │   │
│   │   ├── frontend/components/
│   │   │   ├── AiAssistantSettingsPageClient.tsx  # Settings page
│   │   │   └── McpServersSection.tsx              # MCP server management UI
│   │   │
│   │   └── backend/config/ai-assistant/
│   │       └── page.tsx            # Settings page route
│   │
│   └── frontend/
│       ├── index.ts                # Frontend exports
│       ├── types.ts                # Frontend TypeScript types
│       ├── constants.ts            # UI constants
│       │
│       ├── hooks/
│       │   ├── useCommandPalette.ts # Main command palette state/logic
│       │   ├── useMcpTools.ts       # Tool fetching and execution
│       │   ├── useRecentTools.ts    # Recent tools tracking
│       │   ├── useRecentActions.ts  # Recent actions tracking
│       │   └── usePageContext.ts    # Page context detection
│       │
│       └── components/CommandPalette/
│           ├── CommandPalette.tsx       # Main component
│           ├── CommandPaletteProvider.tsx # Context provider
│           ├── CommandHeader.tsx        # Back button + phase info
│           ├── CommandFooter.tsx        # Connection status + debug toggle
│           ├── CommandInput.tsx         # Search input
│           ├── ToolChatPage.tsx         # Chat UI with thinking indicator
│           ├── ToolCallConfirmation.tsx # Tool execution confirmation
│           ├── MessageBubble.tsx        # Chat message display
│           ├── DebugPanel.tsx           # Debug events viewer
│           └── ...
```

## Rules for Working with OpenCode

OpenCode is a Go-based AI agent running in headless mode inside Docker.

When you need to interact with OpenCode, follow these rules:
- Use `handleOpenCodeMessage()` from `lib/opencode-handlers.ts` — never call the OpenCode HTTP API directly
- Use `extractTextFromResponse()` to parse response parts — never manually iterate response arrays
- Always pass `sessionId` when continuing a conversation — omitting it creates a new session

**Configuration** (`opencode.json` in Docker):
```json
{
  "mcp": {
    "open-mercato": {
      "type": "sse",
      "url": "http://host.docker.internal:3001/mcp",
      "headers": {
        "x-api-key": "omk_xxx..."
      }
    }
  }
}
```

## Rules for Code Mode Tools

Use 2 meta-tools instead of individual endpoint/schema tools. The AI writes JavaScript that runs in a `node:vm` sandbox:

| Tool | Sandbox globals | When to use |
|------|----------------|-------------|
| `search` | `spec` (OpenAPI paths + entity schemas) | When discovering endpoints, understanding schemas, or exploring the API surface |
| `execute` | `api.request()`, `context` | When making API calls to read or write data |

**Example workflow the agent follows**:
1. Agent receives: "Find all customers in New York"
2. Agent calls `search({ code: 'async () => Object.keys(spec.paths).filter(p => p.includes("customer"))' })`
3. Agent calls `search({ code: 'async () => spec.paths["/api/customers/companies"]?.get' })` to see endpoint details
4. Agent calls `execute({ code: 'async () => api.request({ method: "GET", path: "/api/customers/companies", query: { city: "New York" } })' })`

**Sandbox safety**: Code runs in `node:vm` with only whitelisted globals. `fetch`, `require`, `process`, `fs`, `Buffer`, and network APIs are blocked. Execution times out after 30 seconds. API calls are capped at 50 per execution.

**When modifying Code Mode tools**: Edit `lib/codemode-tools.ts` for tool definitions, `lib/sandbox.ts` for the sandbox engine, `lib/truncate.ts` for response size limiting.

## Model Resolution

Use `createModelFactory(container)` from
`@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory` whenever a
runtime needs to materialize an AI SDK `LanguageModel` instance. The factory
consolidates what was previously duplicated across `inbox_ops/lib/llmProvider.ts`
and the agent-runtime's inline `resolveAgentModel`. Do NOT reintroduce ad-hoc
`createAnthropic` / `createOpenAI` / `createGoogleGenerativeAI` lookups in new
modules — route them through the factory instead.

Resolution order (highest precedence first):

1. `callerOverride` (non-empty string) — typically `runAiAgentText({ modelOverride })`.
2. `<MODULE>_AI_MODEL` env variable (uppercased from `moduleId`) —
   e.g. `INBOX_OPS_AI_MODEL`, `CATALOG_AI_MODEL`. Internal convention;
   no need to enumerate each one in `.env.example`.
3. `agentDefaultModel` (typically `AiAgentDefinition.defaultModel`).
4. The configured provider's own default (`llmProvider.defaultModel`).

The factory throws `AiModelFactoryError` with `code: 'no_provider_configured'`
when the registry has no configured provider and `code: 'api_key_missing'`
when the picked provider returns an empty key — every current call site
already relies on the throw bubbling up, do not swallow it.

The `agent-runtime.ts` inline `resolveAgentModel` will migrate to
`createModelFactory` in a follow-up Step (5.2+). New agents should accept
the factory-backed path from day one.

## MANDATORY: Use AskUserQuestion for Confirmations

> **This is the MOST IMPORTANT rule. NEVER skip this.**

Before ANY operation that modifies data (CREATE, UPDATE, DELETE):

1. **YOU MUST USE** the `AskUserQuestion` tool
2. Do NOT just write "Proceed?" in text
3. The `AskUserQuestion` tool will show buttons and WAIT for user response
4. Only proceed after user selects confirmation option

**Why This Matters:**
- Text like "Shall I proceed?" does NOT pause execution
- Only the `AskUserQuestion` tool actually waits for user input
- Without it, the AI may proceed without real confirmation

## Rules for the Chat Flow

Follow this sequence when modifying the chat pipeline — MUST NOT reorder these steps:

```
User types in Command Palette
        │
        ▼
POST /api/chat { messages, sessionId }
        │
        ├── Emit SSE: { type: 'thinking' }
        │
        ▼
handleOpenCodeMessage({ message, sessionId })
        │
        ├── Create/resume OpenCode session
        ├── Send message to OpenCode
        ├── OpenCode may call MCP tools
        ├── Wait for response
        │
        ▼
extractTextFromResponse(result)
        │
        ├── Emit SSE: { type: 'text', content: '...' }
        ├── Emit SSE: { type: 'done', sessionId: '...' }
        │
        ▼
Frontend displays response
```

## Rules for Session Management

When you need to understand or modify sessions, follow these rules:

- MUST use `opencodeSessionIdRef` (React ref) alongside `opencodeSessionId` (state) — refs avoid stale closures in callbacks
- MUST return `sessionId` in the `done` SSE event — the frontend depends on this to persist context
- MUST NOT use `Promise.race` for SSE completion — wait only on the SSE event promise (see bug fix below)

```typescript
// First message creates a session
const result1 = await handleOpenCodeMessage({
  message: "Search for customers"
})
// result1.sessionId = "ses_abc123"

// Subsequent messages reuse the session
const result2 = await handleOpenCodeMessage({
  message: "Now filter by New York",
  sessionId: "ses_abc123"  // Continues conversation
})
```

## API Routes

| Route | Method | When to use / MUST rules |
|-------|--------|--------------------------|
| `/api/chat` | POST | Use for all AI chat interactions. MUST stream SSE events. MUST include sessionId in done event. |
| `/api/tools` | GET | Use to list all available tools. Returns tools filtered by user permissions. |
| `/api/tools/execute` | POST | Use to execute a specific tool directly (bypassing chat). MUST validate permissions. |
| `/api/settings` | GET/POST | Use to read/write AI provider configuration. MUST require `ai_assistant.settings.manage` feature. |
| `/api/mcp-servers` | GET/POST | Use to manage external MCP server configs. MUST require `ai_assistant.mcp_servers.manage` for writes. |

### Rules for the Chat API

**Request format**:
```typescript
{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  sessionId?: string  // Optional, for continuing conversation
}
```

**SSE event types — MUST emit in this order**:
```typescript
type ChatSSEEvent =
  | { type: 'thinking' }                              // Emit first — agent is processing
  | { type: 'text'; content: string }                 // Response text
  | { type: 'tool-call'; id: string; toolName: string; args: unknown }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'done'; sessionId?: string }              // Emit last — include session ID
  | { type: 'error'; error: string }                  // Emit on error
```

## Rules for Frontend State

Use phases instead of pages when working with the command palette:

```typescript
type PalettePhase =
  | 'idle'       // Empty, waiting for input
  | 'routing'    // Analyzing intent (fast)
  | 'chatting'   // Conversational mode
  | 'confirming' // Waiting for tool confirmation
  | 'executing'  // Tool running

interface CommandPaletteContextValue {
  state: {
    isOpen: boolean
    phase: PalettePhase
    inputValue: string
    isLoading: boolean
    isStreaming: boolean
    connectionStatus: ConnectionStatus
  }
  isThinking: boolean  // OpenCode is processing

  // Actions
  handleSubmit: (query: string) => Promise<void>
  sendAgenticMessage: (content: string) => Promise<void>
  approveToolCall: (id: string) => Promise<void>
  rejectToolCall: (id: string) => void

  // Debug
  debugEvents: DebugEvent[]
  showDebug: boolean
  setShowDebug: (show: boolean) => void
}
```

**MUST rules for frontend state:**
- MUST transition phases in order: `idle` -> `routing` -> `chatting`/`confirming`/`executing` -> `idle`
- MUST use ref + state pattern for sessionId (see Session Management below)
- MUST NOT reset `debugEvents` when a new message is sent — append only

## Running the Stack

### Choose an MCP Server Mode

| Feature | Dev (`mcp:dev`) — when to use | Production (`mcp:serve`) — when to use |
|---------|-------------------------------|----------------------------------------|
| Auth | API key only | API key + session tokens |
| Permission check | Once at startup | Per tool call |
| Session tokens | Not required | Required |
| Use case | Use for Claude Code, MCP Inspector, local testing | Use for web-based AI chat |

#### Start the Dev Server (`yarn mcp:dev`)

Use for local development and Claude Code integration. Authenticates once using an API key.

```bash
# Reads API key from .mcp.json headers.x-api-key or OPEN_MERCATO_API_KEY env
yarn mcp:dev
```

Configure via `.mcp.json`:
```json
{
  "mcpServers": {
    "open-mercato": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "x-api-key": "omk_your_key_here"
      }
    }
  }
}
```

#### Start the Production Server (`yarn mcp:serve`)

Use for web-based AI chat. Requires two-tier auth: server API key + user session tokens.

```bash
# Requires MCP_SERVER_API_KEY in .env
yarn mcp:serve
```

### Start the Full Stack

1. Start the MCP server:
   ```bash
   # For development/Claude Code:
   yarn mcp:dev

   # For production/web chat:
   yarn mcp:serve
   ```

2. Start OpenCode (Docker):
   ```bash
   docker start opencode-mvp
   # Or: docker-compose up opencode
   ```

3. Verify connectivity:
   ```bash
   # MCP health
   curl http://localhost:3001/health
   # {"status":"ok","mode":"development","tools":10}

   # OpenCode health
   curl http://localhost:4096/global/health
   # {"healthy":true,"version":"1.1.21"}

   # OpenCode MCP connection
   curl http://localhost:4096/mcp
   # {"open-mercato":{"status":"connected"}}
   ```

4. Start Next.js:
   ```bash
   yarn dev
   ```

5. Verify end-to-end:
   - Open browser, press Cmd+K
   - Type: "What tools do you have?"
   - Confirm you see "Agent is working..." then a response listing tools

## Permissions (ACL)

| Feature ID | When to use / MUST rules |
|------------|--------------------------|
| `ai_assistant.view` | MUST require for any AI Assistant UI access |
| `ai_assistant.settings.manage` | MUST require for reading or writing AI provider settings |
| `ai_assistant.mcp.serve` | MUST require for starting the MCP server via CLI |
| `ai_assistant.tools.list` | MUST require for listing available MCP tools |
| `ai_assistant.mcp_servers.view` | MUST require for viewing external MCP server configs |
| `ai_assistant.mcp_servers.manage` | MUST require for creating/editing/deleting MCP server configs |

## Workers

| Worker | Queue | Purpose |
|--------|-------|---------|
| `workers/ai-pending-action-cleanup` | `ai-pending-action-cleanup` | Scans every tenant for expired pending mutation approvals (`status = 'pending'` AND `expires_at < now`) and flips them to `expired` via the state-machine guard, emitting `ai.action.expired` per row. Race-safe: rows that concurrently transitioned (e.g., a confirm beat us) throw `AiPendingActionStateError` from the repo and are skipped without emitting. Runs on a 5-minute system-scope interval (registered by `setup.ts`). Manually invoked via `yarn mercato ai_assistant run-pending-action-cleanup`. Concurrency: 1. |

## Events

Typed pending-action lifecycle events live in `src/modules/ai_assistant/events.ts` and are emitted via the shared `emitAiAssistantEvent` helper (`createModuleEvents`). The three ids are FROZEN per `BACKWARD_COMPATIBILITY.md` §5 and MUST NOT be renamed; payload fields are additive-only. `ai.action.confirmed` fires from `executePendingActionConfirm` with `{ pendingActionId, agentId, toolName, status, tenantId, organizationId, userId, resolvedByUserId, resolvedAt, executionResult, failedRecords? }`; `ai.action.cancelled` fires from `executePendingActionCancel` with the same shape plus an optional `reason`; `ai.action.expired` fires from the cancel helper's TTL short-circuit (and the Step 5.12 cleanup worker) with `resolvedByUserId: null` and additional `expiresAt` / `expiredAt` timestamps. All three use `category: 'system'` and `entity: 'ai_pending_action'`.

## Rules for the OpenCode Client

Located in `lib/opencode-client.ts`. Use these methods when interacting with OpenCode:

```typescript
class OpenCodeClient {
  health(): Promise<OpenCodeHealth>
  mcpStatus(): Promise<OpenCodeMcpStatus>
  createSession(): Promise<OpenCodeSession>
  getSession(id: string): Promise<OpenCodeSession>
  sendMessage(sessionId: string, message: string): Promise<OpenCodeMessage>
}

// Use this factory — never construct OpenCodeClient directly
function createOpenCodeClient(config?: Partial<OpenCodeClientConfig>): OpenCodeClient
```

## Rules for OpenCode Handlers

Located in `lib/opencode-handlers.ts`. Use these when processing chat requests:

```typescript
// Use for all chat API requests — handles session create/resume automatically
async function handleOpenCodeMessage(options: {
  message: string
  sessionId?: string
}): Promise<OpenCodeTestResponse>

// Use to extract displayable text from OpenCode response parts
function extractTextFromResponse(result: OpenCodeMessage): string
```

## Rules for Code Mode Internals

Located in `lib/codemode-tools.ts`, `lib/sandbox.ts`, `lib/truncate.ts`.

```typescript
// lib/codemode-tools.ts — Tool definitions
loadCodeModeTools(): Promise<number>  // Registers search + execute, returns 2

// lib/sandbox.ts — Sandbox engine
createSandbox(globals, options?): { execute: (code: string) => Promise<SandboxResult> }
normalizeCode(code: string): string   // Strip markdown fences, validate shape

// lib/truncate.ts — Response limiting
truncateResult(value, maxChars?): string  // Default 40K chars (~10K tokens)
```

**Legacy files kept but unused**: `lib/api-discovery-tools.ts` (old find_api/call_api) and `lib/entity-graph-tools.ts` (old discover_schema) remain in the tree but are no longer imported.

## Rules for the API Endpoint Index

Located in `lib/api-endpoint-index.ts`. Use the singleton pattern — never instantiate directly:

```typescript
class ApiEndpointIndex {
  static getInstance(): ApiEndpointIndex
  searchEndpoints(query: string, options?: SearchOptions): EndpointMatch[]
  getEndpoint(operationId: string): EndpointInfo | null
  getEndpointByPath(method: string, path: string): EndpointInfo | null
}
```

## Docker Configuration

### Rules for the OpenCode Container

When modifying the Docker setup, follow this structure:

```yaml
# docker-compose.yml
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

### OpenCode Config

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "mcp": {
    "open-mercato": {
      "type": "sse",
      "url": "http://host.docker.internal:3001/mcp",
      "headers": {
        "x-api-key": "omk_..."
      }
    }
  }
}
```

MUST use `host.docker.internal` (not `localhost`) for Docker-to-host communication.

## Rules for the Debug Panel

Toggle with "Debug" button in Command Palette footer. Use this for inspecting tool calls.

### Debug Event Types

```typescript
type DebugEventType =
  | 'thinking'    // Agent started processing
  | 'tool-call'   // Tool called
  | 'tool-result' // Tool result
  | 'text'        // Text response
  | 'error'       // Error occurred
  | 'done'        // Complete
  | 'message'     // Chat message
  | 'connection'  // Connection status change
```

When adding new debug events, MUST use one of the existing types above or add to this enum first.

---

## When Debugging Session Issues, Follow These Steps

### Step 1: Understand the Session Flow

```
Frontend (useCommandPalette.ts)
    ↓ sessionId in request body
Backend (route.ts)
    ↓ sessionId passed to handler
OpenCode Handler (opencode-handlers.ts)
    ↓ client.getSession(sessionId) or createSession()
OpenCode Client (opencode-client.ts)
    ↓ GET /session/{id} or POST /session
OpenCode Server (Docker :4096)
    → Maintains conversation context
```

### Step 2: Trace the Session ID Flow

1. **First message**: No sessionId -> `startAgenticChat()` creates new session
2. **OpenCode responds**: SSE stream emits `{ type: 'done', sessionId: 'ses_xxx' }`
3. **Frontend stores**: `opencodeSessionIdRef.current = sessionId`
4. **Subsequent messages**: `sendAgenticMessage()` includes sessionId in request body
5. **Backend receives**: Uses existing session instead of creating new one

### Step 3: Check for the React Ref vs State Problem

**Problem**: Using `useState` alone for sessionId causes stale closure issues in callbacks.

```typescript
// BAD: Stale closure - callback captures initial null value
const [sessionId, setSessionId] = useState<string | null>(null)
const handleSubmit = useCallback(async (query) => {
  if (sessionId) {  // Always null in closure!
    await continueSession(query)
  }
}, [sessionId])  // Even with dependency, timing issues persist
```

**Use this pattern instead** — both state (for React reactivity) AND ref (for callbacks):

```typescript
// GOOD: Ref always has current value
const [opencodeSessionId, setOpencodeSessionId] = useState<string | null>(null)
const opencodeSessionIdRef = useRef<string | null>(null)

const updateOpencodeSessionId = useCallback((id: string | null) => {
  opencodeSessionIdRef.current = id  // Update ref first
  setOpencodeSessionId(id)           // Then state for React
}, [])

const handleSubmit = useCallback(async (query) => {
  if (opencodeSessionIdRef.current) {  // Ref has latest value!
    await continueSession(query)
  }
}, [])  // No dependency needed - ref is always current
```

### Step 4: Check for the SSE Completion Bug

**Problem**: `done` event with sessionId was never emitted to frontend.

**Root Cause**: `Promise.race()` resolved when the HTTP call completed, BEFORE the SSE handler received `session.status: idle`:

```typescript
// BUG: sendPromise resolves before SSE emits session.status: idle
await Promise.race([eventPromise, sendPromise.catch(err => Promise.reject(err))])
```

**Use this pattern instead** — only wait for SSE completion:

```typescript
// FIXED: SSE determines completion, not HTTP response
client.sendMessage(session.id, message, { model }).catch((err) => {
  console.error('[OpenCode] Send error (SSE should handle):', err)
})
await eventPromise  // Only SSE determines completion
```

### Step 5: Understand the OpenCode SSE Event Sequence

OpenCode emits events via Server-Sent Events. Completion follows this order:

1. `session.status: busy` — Processing started
2. `message.part.updated` — Text chunks, tool calls, tool results
3. `message.updated` — Message completed (with tokens, timing)
4. `session.status: idle` — Processing complete, triggers `done` event

**Key insight**: The `session.status: idle` event triggers `done`, not HTTP completion.

### Step 6: Add Diagnostic Logging

When tracing session issues, add these logs:

```typescript
// Frontend: useCommandPalette.ts
console.log('[handleSubmit] DIAGNOSTIC - Session check:', {
  refValue: opencodeSessionIdRef.current,
  willContinue: !!opencodeSessionIdRef.current,
})

// Backend: route.ts
console.log('[AI Chat] DIAGNOSTIC - Request received:', {
  hasSessionId: !!sessionId,
  sessionId: sessionId ? sessionId.substring(0, 20) + '...' : null,
})
```

**Verify these checkpoints**:
1. First message: `refValue: null, willContinue: false`
2. After first response: Look for `Done event` with sessionId
3. Second message: `refValue: 'ses_xxx', willContinue: true`
4. Backend: `hasSessionId: true`

### Common Session Problems

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Second message loses context | sessionId not stored | Check `done` event has sessionId |
| `refValue: null` on second message | Stale closure | Use ref pattern (see Step 3) |
| Backend `hasSessionId: false` | Request serialization issue | Check JSON.stringify includes sessionId |
| `done` event never emitted | Promise.race bug | See Step 4 above |
| Multiple `session-authorized` events | Creating new session each time | sessionId not passed to backend |

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Agent is working..." forever | OpenCode not responding | Run `curl http://localhost:4096/global/health` |
| "MCP connection failed" | MCP server not running | Start with `yarn mercato ai_assistant mcp:serve-http --port 3001` |
| Empty response | OpenCode not connected to MCP | Run `curl http://localhost:4096/mcp` |
| "Unauthorized" error | Missing/invalid API key | Check x-api-key in opencode.json |
| Tools not found | Endpoint not in OpenAPI | Regenerate OpenAPI spec |
| Context lost between messages | Session ID not persisted | See "When Debugging Session Issues" above |
| "Session expired" errors | Session token TTL exceeded | Close and reopen chat (creates new 2-hour token) |
| Tools fail with UNAUTHORIZED | Missing _sessionToken | Verify AI is passing token in tool args |

---

## Rules for Two-Tier Authentication

### Tier 1: Server-Level Authentication

Use this tier to validate that requests come from an authorized AI agent (e.g., OpenCode).

```
Request → Check x-api-key header → Compare with MCP_SERVER_API_KEY env var
```

| Aspect | MUST rules |
|--------|------------|
| **Header** | MUST use `x-api-key` — no other header name |
| **Value** | MUST match `MCP_SERVER_API_KEY` environment variable exactly |
| **Configured In** | MUST set in `opencode.json` or `opencode.jsonc` |
| **Validation** | MUST use constant-time string comparison |
| **Result** | Grants access to call MCP endpoints (but no user permissions) |

**Code reference**: `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts:370-391`

### Tier 2: User-Level Authentication (Session Tokens)

Use this tier to identify the actual user and load their permissions for each tool call.

```
Tool call → Extract _sessionToken → Lookup in DB → Load ACL → Check permissions
```

| Aspect | MUST rules |
|--------|------------|
| **Parameter** | MUST use `_sessionToken` in tool call args — injected automatically into schema |
| **Format** | `sess_{32 hex chars}` (e.g., `sess_a1b2c3d4e5f6...`) |
| **TTL** | 120 minutes (2 hours) — MUST NOT extend beyond this |
| **Storage** | `api_keys` table |
| **Lookup** | MUST use `findApiKeyBySessionToken()` — never query directly |
| **ACL** | MUST use `rbacService.loadAcl()` — never bypass |

**Code references**:
- Session creation: `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts:133-157`
- Token lookup: `packages/core/src/modules/api_keys/services/apiKeyService.ts:143-158`
- Context resolution: `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts:32-88`

---

## Rules for Session Tokens

### Generate Tokens Using This Function

```typescript
// packages/core/src/modules/api_keys/services/apiKeyService.ts:99-101
export function generateSessionToken(): string {
  return `sess_${randomBytes(16).toString('hex')}`
}
// Result: "sess_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
```

MUST NOT generate tokens with any other format. MUST use `randomBytes(16)`.

### Token Storage (api_keys table)

When modifying token storage, follow these column constraints:

| Column | Type | MUST rules |
|--------|------|------------|
| `sessionToken` | string | MUST be the `sess_xxx` token for lookup |
| `sessionUserId` | string | MUST reference the user this session represents |
| `rolesJson` | string[] | MUST contain user's role IDs (inherited from user) |
| `tenantId` | string | MUST scope to tenant |
| `organizationId` | string | MUST scope to organization |
| `expiresAt` | Date | MUST default to 120 minutes from creation |

### Inject Tokens Into Messages

When a new chat session starts, the backend injects a system instruction. Follow this pattern:

```typescript
// packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts:161-164
let messageToSend = lastUserMessage
if (sessionToken) {
  messageToSend = `[SYSTEM: Your session token is "${sessionToken}". You MUST include "_sessionToken": "${sessionToken}" in EVERY tool call argument object. Without this, tools will fail with authorization errors.]\n\n${lastUserMessage}`
}
```

MUST NOT remove or modify the system instruction format — the AI agent depends on this exact phrasing.

### Inject Tokens Into Tool Schemas

The MCP server transforms every tool schema to include `_sessionToken`:

```typescript
// packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts:128-131
properties._sessionToken = {
  type: 'string',
  description: 'Session authorization token (REQUIRED for all tool calls)',
}
```

The AI agent sees this parameter and includes it:

```json
{
  "method": "tools/call",
  "params": {
    "name": "api_execute",
    "arguments": {
      "_sessionToken": "sess_a1b2c3d4...",
      "method": "GET",
      "path": "/customers/companies"
    }
  }
}
```

---

## Rules for Session Context Resolution

When a tool call arrives with `_sessionToken`, follow these steps in order:

### Step 1: Extract the Token

```typescript
// http-server.ts:169-170
const sessionToken = toolArgs._sessionToken as string | undefined
delete toolArgs._sessionToken // Remove before passing to handler
```

MUST delete `_sessionToken` from args before passing to the tool handler.

### Step 2: Look Up the Session Key

```typescript
// http-server.ts:42 → apiKeyService.ts:143-158
const sessionKey = await findApiKeyBySessionToken(em, sessionToken)
// Returns null if: not found, deleted, or expired
```

MUST handle `null` return — return a `SESSION_EXPIRED` error.

### Step 3: Load ACL

```typescript
// http-server.ts:59-62
const acl = await rbacService.loadAcl(`api_key:${sessionKey.id}`, {
  tenantId: sessionKey.tenantId ?? null,
  organizationId: sessionKey.organizationId ?? null,
})
```

### Step 4: Build User Context

```typescript
// http-server.ts:73-81
return {
  tenantId: sessionKey.tenantId ?? null,
  organizationId: sessionKey.organizationId ?? null,
  userId: sessionKey.sessionUserId,
  container: baseContext.container,
  userFeatures: acl.features,
  isSuperAdmin: acl.isSuperAdmin,
  apiKeySecret: baseContext.apiKeySecret,
}
```

### Step 5: Check Tool Permissions

```typescript
// http-server.ts:219-238 → auth.ts:127-148
if (tool.requiredFeatures?.length) {
  const hasAccess = hasRequiredFeatures(
    tool.requiredFeatures,
    effectiveContext.userFeatures,
    effectiveContext.isSuperAdmin
  )
  if (!hasAccess) {
    return { error: `Insufficient permissions. Required: ${tool.requiredFeatures.join(', ')}` }
  }
}
```

MUST check permissions AFTER loading ACL — never skip this step even for tools that seem safe.

---

## Rules for SSE Events

### Use These Event Types

```typescript
// packages/ai-assistant/src/modules/ai_assistant/lib/opencode-handlers.ts:218-227
export type OpenCodeStreamEvent =
  | { type: 'thinking' }
  | { type: 'text'; content: string }
  | { type: 'tool-call'; id: string; toolName: string; args: unknown }
  | { type: 'tool-result'; id: string; result: unknown }
  | { type: 'question'; question: OpenCodeQuestion }
  | { type: 'metadata'; model?: string; provider?: string; tokens?: { input: number; output: number }; durationMs?: number }
  | { type: 'debug'; partType: string; data: unknown }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; error: string }
```

### Additional Chat API Events

| Event | Emitted By | When to use |
|-------|------------|-------------|
| `session-authorized` | `chat/route.ts:170-175` | Emit when a new session token is created for a new chat |

### Debug Events (partType values)

| partType | When emitted |
|----------|--------------|
| `question-asked` | When OpenCode asks a confirmation question |
| `message-completed` | When assistant message finishes with token counts |
| `step-start` | When an agentic step begins |
| `step-finish` | When an agentic step completes |

---

## Rules for the MCP HTTP Server

### Enforce the Stateless Request Model

Each HTTP request MUST create a fresh MCP server instance:

```typescript
// http-server.ts:95-278
function createMcpServerForRequest(config, toolContext): McpServer {
  const server = new McpServer(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  )
  // Register all tools (ACL checked per-call)
  // ...
  return server
}
```

MUST NOT cache server instances between requests. MUST NOT store state across requests.

### Apply Schema Transformation

When registering tools, transform schemas to include `_sessionToken`:

1. **Convert** Zod schema to JSON Schema (`z.toJSONSchema()`)
2. **Inject** `_sessionToken` property into `properties`
3. **Convert** JSON Schema to Zod with `.passthrough()`
4. **Result**: AI agent sees token as available parameter

```typescript
// http-server.ts:121-155
const jsonSchema = z.toJSONSchema(tool.inputSchema, { unrepresentable: 'any' })
const properties = jsonSchema.properties ?? {}
properties._sessionToken = {
  type: 'string',
  description: 'Session authorization token (REQUIRED for all tool calls)',
}
jsonSchema.properties = properties
const converted = jsonSchemaToZod(jsonSchema)
safeSchema = (converted as z.ZodObject<any>).passthrough()
```

MUST use `.passthrough()` — without it, `_sessionToken` gets stripped by Zod validation.

### Apply Per-Tool ACL Checks

Each tool call MUST validate permissions using the session's ACL:

```typescript
// http-server.ts:219-239
if (tool.requiredFeatures?.length) {
  const hasAccess = hasRequiredFeatures(
    tool.requiredFeatures,
    effectiveContext.userFeatures,
    effectiveContext.isSuperAdmin
  )
  if (!hasAccess) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: `Insufficient permissions for tool "${tool.name}". Required: ${tool.requiredFeatures.join(', ')}`,
        code: 'UNAUTHORIZED'
      })}],
      isError: true
    }
  }
}
```

### Return Standard Error Responses

| Code | Message | When returned |
|------|---------|---------------|
| `SESSION_EXPIRED` | "Your chat session has expired..." | When token TTL exceeds 2 hours |
| `UNAUTHORIZED` | "Session token required" | When `_sessionToken` is missing from args |
| `UNAUTHORIZED` | "Insufficient permissions" | When user lacks required features for the tool |

---

## Changelog

### 2026-02-22 - Code Mode Tools (search + execute)

**Major change**: Replaced all individual API/schema/module tools with 2 Code Mode meta-tools following Cloudflare's Code Mode pattern.

**What changed**:
- Added `search` tool: AI writes JavaScript to query the OpenAPI spec + entity schemas via a `spec` global
- Added `execute` tool: AI writes JavaScript to make API calls via `api.request()` in a `node:vm` sandbox
- Removed `find_api`, `call_api`, `discover_schema` tools (files kept but no longer imported)
- Removed auto-discovered module AI tools from `ai-tools.generated.ts`
- Token savings: from ~10+ tool schemas to exactly 2, with fixed footprint regardless of API surface growth

**Files created**:
- `lib/codemode-tools.ts` — `search` and `execute` tool definitions
- `lib/sandbox.ts` — `node:vm` sandbox executor with security restrictions
- `lib/truncate.ts` — Response size limiter (40K chars / ~10K tokens)

**Files modified**:
- `lib/api-endpoint-index.ts` — Added `getRawOpenApiSpec()` for raw spec caching
- `lib/tool-loader.ts` — Loads Code Mode tools instead of legacy tools + module tools
- `lib/http-server.ts` — Pre-caches raw OpenAPI spec at startup
- `lib/mcp-server.ts` — Generates entity graph and caches spec for stdio mode

**Files kept but unused**:
- `lib/api-discovery-tools.ts` — Old find_api/call_api (no longer imported)
- `lib/entity-graph-tools.ts` — Old discover_schema (no longer imported)

### 2026-01-17 - Session Persistence Fix

**Lesson learned:** Never use `Promise.race` for SSE completion — the HTTP response resolves before SSE can emit the `done` event. Always await only the SSE event promise.

**Lesson learned:** Always use React refs alongside state for values accessed in callbacks — `useState` alone causes stale closures.

**Bug fixed**: Chat context lost between messages (AI asked "Who is 'his'?" instead of remembering Taylor).

**Root causes**:
1. **Promise.race bug**: `handleOpenCodeMessageStreaming` used `Promise.race([eventPromise, sendPromise])` which resolved when HTTP completed, before SSE could emit `done` event with sessionId.
2. **React stale closure**: `handleSubmit` callback captured initial `null` sessionId value.

**Fixes applied**:
- `opencode-handlers.ts`: Removed Promise.race, await only SSE eventPromise
- `useCommandPalette.ts`: Added `opencodeSessionIdRef` (ref) alongside state to avoid stale closures

**Files modified**:
- `src/modules/ai_assistant/lib/opencode-handlers.ts` - Fixed Promise.race completion bug
- `src/frontend/hooks/useCommandPalette.ts` - Added ref pattern for sessionId

**Diagnostic logging added** (can be removed after verification):
- `[handleSubmit] DIAGNOSTIC` - Session check before routing
- `[sendAgenticMessage] DIAGNOSTIC` - Request payload before fetch
- `[startAgenticChat] DIAGNOSTIC` - Done event handling
- `[AI Chat] DIAGNOSTIC` - Backend request received

### 2026-01 - OpenCode Integration

**Lesson learned:** When replacing an AI backend, preserve the session management contract — the frontend depends on `sessionId` in `done` events regardless of the underlying AI engine.

**Major change**: Replaced Vercel AI SDK with OpenCode as the AI backend.

**What changed**:
- Chat API now routes all requests to OpenCode
- Added session management for conversation context
- Added "Agent is working..." indicator
- OpenCode connects to MCP server for tools
- Removed direct AI provider integration

**Files modified**:
- `src/modules/ai_assistant/api/chat/route.ts` - Complete rewrite to use OpenCode
- `src/frontend/hooks/useCommandPalette.ts` - Added session state, thinking indicator
- `src/frontend/components/CommandPalette/ToolChatPage.tsx` - Added thinking UI
- `src/frontend/types.ts` - Added ChatSSEEvent, isThinking

### 2026-01 - API Discovery Tools

**Lesson learned:** Exposing hundreds of individual tools overwhelms the AI context. Use meta-tools (discover, schema, execute) to let the agent dynamically find what it needs.

**Major change**: Replaced 600+ individual tools with 3 meta-tools.

**What changed**:
- Added `api_discover`, `api_execute`, `api_schema` tools
- Created `ApiEndpointIndex` for OpenAPI introspection
- Hybrid discovery: search + OpenAPI
- 405 endpoints available via discovery

**Files created**:
- `lib/api-discovery-tools.ts`
- `lib/api-endpoint-index.ts`

### 2026-01 - Hybrid Tool Discovery

**Lesson learned:** Neither search-based nor OpenAPI-based discovery alone covers all tools — combine both for comprehensive results.

**What changed**:
- Combined semantic search with OpenAPI introspection
- Tools indexed for fulltext search
- API endpoints indexed from OpenAPI spec

### Previous Changes

See git history for earlier changes including:
- Zod 4 schema handling fixes
- Debug panel addition
- CLI tools fixes
- Raycast-style command palette rewrite

---

## Upgrading / Operator rollout notes

This section captures what existing deployments need to know when picking up the **AI Framework Unification** release (#1593, spec [`2026-04-11-unified-ai-tooling-and-subagents`](../../.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md)). All changes are additive; no runtime contract was renamed or removed.

### New environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_PENDING_ACTION_TTL_SECONDS` | `900` (15 minutes) | Expiry window for pending mutation approvals. After this window the cleanup worker flips `status = 'pending'` rows whose `expires_at < now` to `expired` and emits `ai.action.expired`. |
| `<MODULE>_AI_MODEL` | unset | Per-module model override, uppercased from the module id. Examples: `INBOX_OPS_AI_MODEL`, `CATALOG_AI_MODEL`. Internal convention — no need to enumerate each one in `.env.example`. Resolution order: caller override → this env var → `agentDefaultModel` → configured provider's default. |

### New database table

- Migration `Migration20260419134235_ai_assistant` lands automatically on `yarn db:migrate`. It adds the additive `ai_pending_actions` table that backs the mutation approval gate.
- No data migration is needed. Existing rows in other tables are untouched.
- The runtime gracefully falls back if the table is absent (the mutation gate fails closed rather than blocking the app build).

### New cleanup worker registration

- Worker id: `ai_assistant:pending-action-cleanup` (queue: `ai-pending-action-cleanup`, concurrency: `1`, interval: 5 minutes system-scope).
- Auto-registered via the module's `setup.ts` `seedDefaults`. For existing tenants the worker activates once structural cache is refreshed:

  ```bash
  yarn mercato configs cache structural --all-tenants
  ```

- Manual invocation (useful when debugging or running outside the scheduler):

  ```bash
  yarn mercato ai_assistant run-pending-action-cleanup
  ```

- See the **Workers** section above for the full description.

### New prompt-override + mutation-policy-override tables

- Additive tables: `ai_agent_prompt_overrides`, `ai_agent_mutation_policy_overrides`.
- Both are feature-gated behind `ai_assistant.settings.manage` (standard ACL feature). Operators who don't want the settings UI exposed can remove that feature from role grants — the UI hides itself and the runtime falls back to agent defaults.
- Prompt overrides are versioned with safe additive merge rules (see Step 5.3 of the spec).
- Mutation-policy overrides can NEVER escalate an agent's `mutationPolicy` above what the agent definition declares — the runtime re-checks on every confirm call and refuses at the pending-action gate.

### Backward-compatibility posture

- `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` keeps its public API. The implementation now delegates to `createModelFactory(container)` (see **Model Resolution** above), so callers don't change.
- No existing event IDs, API routes, widget injection spot IDs, DI service names, ACL feature IDs, notification type IDs, CLI commands, or generated file contracts were renamed or removed.
- New routes are namespaced under `/api/ai_assistant/ai/...` and `/api/ai/actions/:id/...`; they do not collide with the existing OpenCode Code Mode routes.

### Coexistence with OpenCode Code Mode

The AI framework unification **does not replace OpenCode Code Mode.** Both stacks run side-by-side and can be enabled independently per tenant and per agent.

| Surface | OpenCode Code Mode (unchanged) | New AI Framework |
|---------|--------------------------------|------------------|
| Chat entrypoint | `POST /api/chat` (SSE, OpenCode in Docker) | `POST /api/ai_assistant/ai/chat?agent=<module>.<agent>` (typed agent dispatcher) |
| Tool discovery | `/api/tools`, `/api/tools/execute` (2 meta-tools: `search` + `execute`) | Typed tool packs (`search.*`, `attachments.*`, `meta.*`, customers, catalog) registered via `defineAiTool()` |
| CLI | `mcp:serve`, `mcp:serve-http`, `mcp:dev` | (none — the dispatcher is an HTTP route, not an MCP process) |
| UI | Raycast-style Command Palette (`Cmd+K`) | `<AiChat>` component, playground page, agent settings page |
| Mutation approvals | N/A (tool call → tool result) | `ai_pending_actions` + approval cards (`mutation-preview-card` / `field-diff-card` / `confirmation-card` / `mutation-result-card`) |
| Demo | General-purpose chat | D18 `catalog.merchandising_assistant` on `/backend/catalog/catalog/products` |

Operators who don't want the new surfaces can:

- remove `ai_assistant.settings.manage` from role grants to hide the settings UI, **or**
- omit individual agents from a tenant via the mutation-policy override table (see Step 5.4), **or**
- simply not mount `<AiChat>` anywhere in custom UIs — the runtime does not activate until an agent is invoked.

Tenants who want both keep OpenCode Code Mode for ad-hoc chat and Code-Mode-style exploration, and use the new framework for focused, mutation-capable agents (e.g., `customers.account_assistant`, `catalog.merchandising_assistant`) with the D16 pending-action contract.

### Operator QA checklist (D18 demo)

For a live end-to-end walkthrough against a real LLM:

1. Set `AI_PENDING_ACTION_TTL_SECONDS=900`, your chosen provider env vars (e.g., `ANTHROPIC_API_KEY`), and optional `CATALOG_AI_MODEL`.
2. Run `yarn db:migrate` to pick up `Migration20260419134235_ai_assistant`.
3. Run `yarn mercato configs cache structural --all-tenants` to register the cleanup worker on existing tenants.
4. Open `/backend/catalog/catalog/products`, pick a handful of rows, open the `<AiChat>` sheet, and walk through each of the four named use cases (description drafting, attribute extraction, title variants, price adjustment suggestion).
5. Confirm the proposal card shows a single `[Confirm All]` approval and that after confirmation the DataTable refreshes via the DOM event bridge as `catalog.product.updated` events arrive per record.
6. Force a partial-success case (e.g., stale-version on one row) and confirm the result card renders the mixed outcome correctly.

---

## Future Development

Refer to git history and specs for planned features:
- AI Agent Authorization & Impersonation
- Actor + Subject model for audit trails
- Permission tiers for rate limiting
- Enhanced confirmation flow
