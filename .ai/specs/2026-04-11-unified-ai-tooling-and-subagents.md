# Unified AI Tooling, Module Sub-Agents & Embeddable Chat

## TLDR
- Add an additive AI runtime on top of the existing `@open-mercato/ai-assistant` package so modules can expose focused sub-agents and embeddable chat without breaking current MCP, OpenCode, or Command Palette behavior.
- Keep `ai-tools.ts`, `AiToolDefinition`, `McpToolDefinition`, `registerMcpTool()`, `ai-tools.generated.ts`, `/api/chat`, `/api/tools`, `mcp:serve`, and `mcp:serve-http` working unchanged.
- Introduce a new additive module convention, `ai-agents.ts`, plus a reusable `<AiChat>` UI component, AI-SDK-first helper APIs, and a new authenticated dispatcher route, `POST /api/ai/chat?agent=<module>.<agent>`.
- V1 ships focused, read-first sub-agents, standard auth, attachment-backed uploads, tagged client-rendered streamed UI parts, explicit coexistence with OpenCode Code Mode, and first-class support for Vercel AI SDK patterns such as `useChat`, direct transport, and structured-output agents built on `generateText(..., { output })`.

## Overview
Open Mercato already has three useful AI building blocks:

1. MCP-compatible tool contracts (`ai-tools.ts`, `McpToolDefinition`, `registerMcpTool()`).
2. An authenticated in-process client and MCP-to-AI-SDK adapter inside `@open-mercato/ai-assistant`.
3. A general-purpose OpenCode-powered Command Palette exposed through `/api/chat`.

What is missing is a productized path for focused, module-owned AI experiences:

- a module-level way to declare a sub-agent with a narrow system prompt and a narrow tool set
- an embeddable chat component that can be mounted on backend and portal pages
- a standard authenticated HTTP endpoint for these focused chats
- one canonical contract that keeps MCP, in-process AI SDK execution, and module tooling aligned
- a Vercel AI SDK-friendly path for teams that want to treat an Open Mercato agent as a normal AI SDK primitive instead of a bespoke runtime
- a first-class file bridge so images, PDFs, and other attachments can be passed to agents safely without leaking private URLs or forcing app teams to hand-roll conversion logic

This specification adds those capabilities without replacing the current stack. OpenCode remains the general assistant. The new stack is for narrow, module-scoped AI features.

## Problem Statement
The current AI stack is powerful but optimized for a general assistant, not embedded product workflows.

Current limitations:

- Module-owned focused agents do not exist as first-class artifacts. A module can expose tools, but not a complete "orders assistant" or "inbox proposal assistant" with an owned prompt, media policy, and tool whitelist.
- The current UI surface is centered on the Command Palette. There is no reusable `<AiChat>` component that a page can embed and bind to a specific agent.
- The current `/api/chat` route is designed around OpenCode and its session/question protocol. It is not the right contract for module-specific agent endpoints.
- The current public surface is not AI SDK-first. A Vercel AI SDK user should be able to wire Open Mercato agents into `useChat`, transport-based chat, or structured-output flows without reverse-engineering internal adapters.
- The current MCP/runtime story is internally inconsistent: the generator still emits `ai-tools.generated.ts`, but current tool loading logic is Code Mode-centric. That mismatch must be resolved before adding more AI extension surfaces.
- File handling is underspecified for AI workloads. The repo already has a mature attachments module, but the current spec does not define how attachment records become model-ready file parts, extracted text, or provider-safe binary payloads.
- The spec does not yet define the baseline tool packs that a "general", "customers", or "catalog" agent should expose, which risks shipping chat shells without enough domain reach to match the UI.
- Mutation safety for focused AI workflows is not formalized outside the existing OpenCode question flow.

Non-goals for this spec:

- Replacing OpenCode.
- Removing or renaming existing MCP routes, chat routes, commands, or generated files.
- Introducing a new top-level package such as `@open-mercato/ai`.
- Per-module MCP endpoints in v1.
- RSC `streamUI` in v1.

## Current-State Verification
Repository inspection on `2026-04-15` confirms the following facts that this spec must design around:

- `packages/ai-assistant/src/modules/ai_assistant/lib/tool-loader.ts` currently registers `context_whoami` plus Code Mode `search` and `execute`, but does not load generated module `ai-tools.ts` contributions. Phase 0 must fix this before any agent rollout.
- `packages/ai-assistant/src/modules/ai_assistant/lib/mcp-tool-adapter.ts` already converts registered tools into AI SDK tools, which means the repo is structurally close to an AI SDK-first runtime.
- The attachments module already exposes stable upload, list, transfer, file, image, and library endpoints under `/api/attachments*`, plus MIME validation, OCR/text extraction hooks, and attachment metadata. The new agent stack must reuse this contract instead of inventing a parallel upload system.
- Customers detail UIs already aggregate the exact read models agents need to be useful: person detail includes notes, activities, deals, addresses, and tasks; company detail adds related people; deal detail includes associations plus notes and activities.
- Catalog UIs already expose the surfaces that tool packs must mirror: products list/detail, categories list/edit, variants, offers, price kinds, product unit conversions, and product media/attachments.

## Decisions

### D1. Package Placement
The new runtime lives inside `@open-mercato/ai-assistant`. New reusable React UI lives in `@open-mercato/ui`.

Rationale:

- avoids import-path churn and BC risk
- keeps auth, tool registry, and MCP interoperability in the existing AI package
- keeps UI primitives in the UI package, where backend/portal consumers already expect them

Planned layout:

- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-registry.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-transport.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/attachment-parts.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/ai-tool-definition.ts`
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/agents/page.tsx`
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/page.tsx`
- `packages/ui/src/ai/AiChat.tsx`

### D2. Tool Source of Truth
The canonical additive contract is `defineAiTool(...)`, but `ai-tools.ts` remains the module convention and existing plain object definitions remain valid.

Rules:

- `ai-tools.ts` remains supported and frozen as a convention file.
- Existing modules may continue exporting `aiTools: AiToolDefinition[]`.
- `defineAiTool(...)` returns an object compatible with `AiToolDefinition`.
- `registerMcpTool()` remains public and functional.
- `AiToolDefinition` remains a public MCP-compatible shape.

This gives one internal canonical builder without forcing a breaking migration.

### D3. Sub-Agent Convention
Add a new additive module convention file: `ai-agents.ts`.

Rules:

- one `ai-agents.ts` file per module root
- export `aiAgents: AiAgentDefinition[]`
- optional supporting assets may live under `ai/agents/<agent-id>/`
- the root `ai-agents.ts` is the discovery surface; support folders are implementation detail only

### D4. HTTP Route Shape
V1 uses one canonical dispatcher route:

- `POST /api/ai/chat?agent=<module>.<agent>`

Per-agent aliases are out of scope for v1. They may be added later as additive aliases if documentation or external integrations need them.

### D5. Auth Model
The new HTTP layer uses standard Open Mercato auth:

- cookie session
- JWT bearer auth
- `x-api-key`

Rules:

- the new `/api/ai/chat` route is guarded with normal route metadata
- in-process calls accept a pre-authenticated context object created by the same auth pipeline
- the legacy MCP HTTP server keeps its current session-token model unchanged
- no new two-tier auth is introduced for the new focused-agent HTTP surface

### D6. Provider Source
V1 reuses existing `ai_assistant` tenant settings and provider resolution.

Rules:

- tenant-level provider/model stays the default
- agents may override `defaultModel`
- agent-specific provider keys are out of scope for v1

### D7. Streamed UI Pattern
V1 uses tagged client-rendered streamed UI parts, not RSC `streamUI`.

Rules:

- server emits structured UI parts with `componentId` and serializable props
- client maps `componentId` to registered React components
- this works in backend and portal surfaces without RSC-specific auth/context plumbing

### D8. Coexistence Strategy
The new stack coexists with current `ai-assistant` Command Palette and OpenCode Code Mode.

Rules:

- `/api/chat` remains the general assistant route
- OpenCode `search` and `execute` remain supported
- Command Palette behavior is unchanged by this spec
- no deprecation is introduced in this spec

### D9. File Upload Storage
V1 reuses the existing attachments module.

Rules:

- `<AiChat>` uploads files through existing attachment flows
- chat requests pass `attachmentIds`, not raw file blobs
- attachment ACL, tenant scoping, and storage backend reuse the existing attachments contract
- when tenant data encryption is enabled, attachment storage must continue honoring the current encryption policy

### D10. MCP Surface
V1 keeps the current generalized MCP server only.

Rules:

- no `/mcp/<module>` endpoints in v1
- sub-agents may be exposed through the generalized MCP registry later as additive tools
- raw tools continue to flow through the existing generalized MCP surface

### D11. Community-Sourced Future Enhancements
Several ideas from the community-contributed decentralized AI specs (PR #1222) are worth adopting in later phases. The high-value ideas have been integrated directly into this spec as optional, additive fields on `AiAgentDefinition`:

Adopted into the type definition (available from Phase 0, used progressively):

- **Page context resolver** (`resolvePageContext`): modules hydrate rich record-level context instead of relying on pass-through `pageContext`. Used at runtime from Phase 3+.
- **Routing metadata** (`keywords`, `domain`, `dataCapabilities`): emitted in the generated registry from Phase 0, consumed by a future agent-suggestion feature in Phase 4+.
- **Execution budget** (`maxSteps`): turn-level step limit passed to `streamText()`. Available from Phase 1, recommended for mutation-capable agents in Phase 4+.

Deferred to Phase 3 implementation (not in the type definition yet):

- **Shared model factory**: consolidate provider/model resolution from `inbox_ops/lib/llmProvider.ts` into a reusable utility in `@open-mercato/ai-assistant` when the second agent is built. Support `defaultModel` override plus optional env-based per-agent override (`<MODULE>_AI_MODEL`).

Tracked for Phase 4+ (design only, no implementation commitment):

- **Context dependencies**: modules declare higher-level affinities (`contextDependencies: ['customers', 'catalog']`) that auto-resolve to tool whitelists. Convenience layer over explicit `allowedTools`.
- **Versioned manifest contract**: add `manifestVersion` and `platformRange` to `AiAgentDefinition` when external modules ship AI agents. Follow existing module versioning patterns from SPEC-061/064/065.

Credit: ideas extracted from @rchrzanwlc's research in PR #1222. Full analysis in `.ai/specs/2026-04-13-pr-1222-decentralized-ai-analysis.md`.

### D12. AI SDK-First Public Adapters
The new runtime must feel native to Vercel AI SDK users. The HTTP route is necessary, but it is not sufficient.

Rules:

- expose a thin public helper for `useChat` transport creation so app code can bind `agentId`, custom body fields, and debug flags without hand-rolling URLs
- expose a server-side helper that resolves an Open Mercato agent into AI SDK-compatible tools plus instructions/context for direct `generateText()` / `streamText()` usage
- expose a structured-output helper so teams can run a focused Open Mercato agent as a normal object-producing call using AI SDK `output` instead of re-implementing the agent contract manually
- the public helper surface must stay additive and optional; advanced teams may still call lower-level runtime APIs directly

Design implication:

- V1 supports two agent execution shapes:
  - `chat` agents for multi-turn transcript-based flows
  - `object` agents for single-turn or bounded structured-output workflows

### D13. Attachment-to-Model Bridge
Attachments stay stored as Open Mercato records, but the runtime must convert them into model-safe payloads before invocation.

Rules:

- clients send `attachmentIds`, never raw long-lived URLs
- the runtime resolves each attachment record, validates tenant/org scope, and converts it into AI SDK-compatible file parts or text parts
- never pass authenticated frontend URLs directly to providers; use short-lived signed URLs, inline bytes, or extracted text depending on provider capability and file type
- images and PDFs are first-class inputs; text-like files (`txt`, `md`, `csv`, `json`) should also be converted into model-usable content
- unsupported binary files still appear in agent context as metadata so the model can acknowledge them instead of silently ignoring them

### D14. Prompt Contract and Override Model
Prompt authoring should be structured from the start so the system is easy to reason about, test, and customize.

Rules:

- replace the flat mental model of one long `systemPrompt` string with a structured prompt composition contract, even if the stored value remains additive-compatible with `systemPrompt`
- every agent prompt is composed from named sections: role, scope, available data/tools, attachment guidance, mutation policy, response style, and tenant/admin overrides
- tenant admins may add additive prompt snippets and custom instructions through settings, but must not be able to disable hard safety sections
- prompt overrides are versioned and attached to the agent id so they can be tested and audited independently

### D15. Tool Coverage Must Follow Real UI Capability
Agent tools should not be an arbitrary API wrapper set. They must let users reach the same business data and operations that the UI exposes.

Rules:

- every production agent must declare a tool pack that maps to real UI surfaces, not only raw CRUD endpoints
- read tools should prefer aggregated detail/read-model outputs that mirror the UI tabs and panels users already understand
- write tools should correspond to actual UI actions and command-backed operations already supported in the repo
- the first module coverage target for this spec is `customers` and `catalog`

## Proposed Solution

### 1. Additive Tool Builder
Add `defineAiTool()` as a thin additive builder over the existing MCP-compatible tool shape.

Core properties:

- `name`
- `description`
- `inputSchema`
- `requiredFeatures`
- `handler`

Additive optional properties:

- `displayName`
- `tags`
- `isMutation`
- `maxCallsPerTurn`
- `supportsAttachments`

Rules:

- `isMutation` defaults to `false`
- mutation-capable tools are not automatically allowed in v1 focused agents
- handler execution continues to use the existing `executeTool()` path so validation, ACL, and context stay aligned

### 2. Module-Owned Sub-Agents
Add `AiAgentDefinition` and a new `ai-agents.ts` convention.

```ts
type AiAgentDefinition = {
  id: string
  moduleId: string
  label: string
  description: string
  executionMode?: 'chat' | 'object'
  systemPrompt: string
  allowedTools: string[]
  defaultModel?: string
  acceptedMediaTypes?: Array<'image' | 'pdf' | 'file'>
  requiredFeatures?: string[]
  uiParts?: string[]
  readOnly?: boolean
  maxSteps?: number
  output?: {
    schemaName: string
    schema: ZodTypeAny | StandardSchemaV1
    mode?: 'generate' | 'stream'
  }
  resolvePageContext?: (ctx: {
    entityType: string
    recordId: string
    container: AwilixContainer
    tenantId: string | null
    organizationId: string | null
  }) => Promise<string | null>
  keywords?: string[]
  domain?: string
  dataCapabilities?: {
    entities?: string[]
    operations?: Array<'read' | 'search' | 'aggregate'>
    searchableFields?: string[]
  }
}
```

Rules:

- `id` format: `<module>.<agent>`
- `executionMode` defaults to `chat`
- `allowedTools` is an explicit whitelist
- `readOnly` defaults to `true` in v1
- if `readOnly` is `true`, tools marked `isMutation: true` are rejected at registration/runtime
- focused agents may call other focused agents only in a later phase; v1 agents only call tools
- `maxSteps` is optional; when set, limits the number of tool-call steps the runtime will execute per turn (passed to `streamText()`)
- `output` is optional and only valid for `executionMode: 'object'`; it lets app teams run a focused agent through structured-output APIs without hand-writing the prompt and tool plumbing
- `resolvePageContext` is optional; when present, the runtime calls it before composing the system prompt, injecting the returned string as additional context about the record the user is currently viewing — this replaces generic `pageContext` pass-through with module-owned hydration
- `keywords`, `domain`, and `dataCapabilities` are optional routing metadata; v1 ignores them at runtime but they are emitted in the generated registry for future agent-suggestion features

### 3. Standard Agent Runtime
Add an internal focused-agent runtime that:

- resolves the agent definition from the generated registry
- authenticates with standard Open Mercato auth
- creates a request-scoped execution context
- if the agent declares `resolvePageContext` and the request includes `pageContext` with `entityType` and `recordId`, calls the resolver and injects the result into the system prompt before the first model call
- resolves whitelisted tools from the shared tool registry
- adapts those tools to AI SDK tool execution using the same handler/ACL contract
- enforces `maxSteps` when declared on the agent definition
- resolves `executionMode: 'object'` agents into AI SDK structured-output calls instead of transcript-oriented chat loops
- converts `attachmentIds` into validated model-ready file or text parts before invocation
- streams text and tagged UI parts back to the client

Important constraint:

- this is an internal runtime optimization, not a new public module-authoring contract
- module authors still author MCP-compatible tools and declarative agent definitions

### 4. AI SDK-First Adapters
Expose additive helpers so Open Mercato agents feel native in Vercel AI SDK codebases.

Public helpers:

- `createAiAgentTransport({ agentId, ... })` for `useChat`
- `resolveAiAgentTools({ agentId, authContext, pageContext, attachmentIds })`
- `runAiAgentText({ agentId, messages, ... })`
- `runAiAgentObject({ agentId, input, ... })`

Rules:

- `runAiAgentObject()` uses AI SDK structured-output execution (`generateText` / `streamText` with `output`) instead of inventing a separate object-agent abstraction
- helper inputs accept the same additive context used by the HTTP runtime: `pageContext`, `attachmentIds`, `debug`, and optional model override
- transport helpers support request-level custom body fields so frontend pages can pass page context or agent settings without mutating the transcript

### 5. Embeddable `<AiChat>`
Add a reusable UI component for backend and portal pages.

Supported bindings:

- `agentId="<module>.<agent>"`
- future `tools=[...]` freeform mode is out of scope for v1

Supported media:

- text
- image attachments
- PDF attachments
- generic file attachments already supported by the attachments module

Companion examples in scope:

- a backend playground page where a user can pick the general assistant or a module agent and chat against it
- a debug-friendly example that shows transcript events, tool calls, attachment previews, and structured output for object agents

### 6. Safe V1 Scope
V1 focused agents are read-first.

Rules:

- agent-bound chat may use only read-only tools in v1
- mutation-capable tools remain available through the existing general assistant/MCP flows
- mutation-capable focused agents are deferred to a later follow-up spec once confirmation semantics are unified

### 7. Tool Packs and Coverage
V1 introduces explicit tool-pack guidance so agents are useful on day one.

General-purpose tool packs to add:

| Tool Pack | Purpose | Backing repo surface |
|------|--------|-------|
| `search.hybrid_search` | Global fulltext + vector + token search over enabled entities | `packages/search`, module `search.ts` configs |
| `search.get_record_context` | Resolve presenter, links, and summary for a search hit | `packages/search` presenter/buildSource pipeline |
| `attachments.list_record_attachments` | List files bound to a record | `/api/attachments` |
| `attachments.read_attachment` | Fetch attachment metadata plus extracted text when available | `/api/attachments/library/[id]`, OCR/text extraction |
| `attachments.transfer_record_attachments` | Move uploaded files from temp or draft records to saved records | `/api/attachments/transfer` |
| `meta.describe_agent` | Return agent metadata, prompt sections, and tool pack summary | generated agent registry |
| `meta.list_agents` | Enumerate general and module agents the current user can access | generated agent registry + RBAC |

Customers tool coverage requirements:

| Aggregate / Operation | Minimum tool coverage |
|------|--------|
| People list + detail | list/search people; get person detail with notes, activities, deals, addresses, tasks, tags, custom fields |
| Companies list + detail | list/search companies; get company detail with notes, activities, deals, people, addresses, tasks, tags, custom fields |
| Deals | list/search deals; get deal detail with notes, activities, people, companies; create/update/delete deal |
| Activities and tasks | list/create/update activities; complete/cancel interaction; list/create/update customer tasks |
| Addresses | list/create/update/delete addresses |
| Tags | list/create tags; assign/unassign tags |
| Settings data | pipelines, pipeline stages, dictionaries, address format settings |

Catalog tool coverage requirements:

| Aggregate / Operation | Minimum tool coverage |
|------|--------|
| Products list + detail | list/search products; get product detail with categories, variants, prices, offers, media, metadata, unit conversions |
| Categories | list tree/manage categories; get category detail; create/update/archive category |
| Variants | list/create/update/delete variants and surface option values/media |
| Prices and price kinds | list/create/update/delete prices; list/create/update/delete price kinds |
| Offers | list/create/update/delete offers |
| Product media | list product media and manage attachment associations |
| Product configuration | option schemas, tags, product unit conversions, bulk delete |

### 8. Prompt Templates and Settings
The first implementation should ship prompt templates, not ad hoc strings.

Required prompt sections:

- `ROLE`: what the agent is responsible for
- `SCOPE`: module boundaries and current page context
- `DATA`: which read models and entities the agent can access
- `TOOLS`: allowed tool packs and when to use them
- `ATTACHMENTS`: how to interpret images, PDFs, and files
- `MUTATION POLICY`: confirmation and safety rules
- `RESPONSE STYLE`: concise, business-facing output rules

Baseline prompt blueprints to ship with the first implementation:

```md
[ROLE]
You are the Open Mercato workspace assistant. Help the user find information, explain records, summarize files, and suggest next actions using only the tools and data currently available.

[SCOPE]
You may access only the current tenant and organization scope. Respect feature-based access control and do not invent records, actions, or permissions.

[DATA]
Prefer aggregate read-model tools over raw CRUD lists when they exist. Reuse page context and attachment content before asking for more data.

[ATTACHMENTS]
Images and PDFs may contain important business context. Summarize what is visible, mention uncertainty, and reference attached files explicitly when they influence the answer.

[MUTATION POLICY]
Never execute a write without an explicit user confirmation step. Summarize the intended change first.

[RESPONSE STYLE]
Be concise, business-facing, and action-oriented. Avoid raw IDs and internal implementation terms unless the user asks for them.
```

```md
[ROLE]
You are the customers workspace assistant. Help with people, companies, deals, activities, tasks, addresses, tags, pipelines, and CRM settings.

[DATA]
Prefer person/company/deal detail aggregate tools so the answer matches the CRM detail pages. Use timeline-style summaries when notes, activities, and tasks all matter.

[MUTATION POLICY]
When a user wants to change CRM data, explain exactly which record and fields will change before asking for confirmation.
```

```md
[ROLE]
You are the catalog merchandising assistant. Help with products, categories, variants, prices, offers, media, and product configuration.

[DATA]
Prefer product detail aggregate tools so the answer includes media, categories, variants, pricing, offers, and custom metadata in one coherent view.

[ATTACHMENTS]
Use attached images and PDFs as merchandising context. Mention when an answer depends on visual interpretation.
```

First settings page scope:

- agent registry view with enabled/disabled status per agent
- prompt override editor with additive tenant instructions
- tool toggle / tool-pack visibility controls
- attachment policy controls by media type and size budget
- sample context injection fields for testing prompts without changing production pages

## Architecture

### Runtime Layers

1. Module authoring layer
   - `ai-tools.ts`
   - `ai-agents.ts`

2. Generated registries
   - `ai-tools.generated.ts` remains unchanged and public
   - new additive `ai-agents.generated.ts`

3. Runtime registries
   - tool registry
   - agent registry

4. Execution adapters
   - MCP execution through existing MCP server/runtime
   - in-process execution through the existing `executeTool()` contract
   - AI SDK adapter built from the same tool definitions
   - structured-output execution path for `executionMode: 'object'`

5. HTTP/UI layer
   - `POST /api/ai/chat?agent=...`
   - `<AiChat>`
   - playground page
   - agent settings page

### Generator Changes

Existing generated artifacts that stay:

- `ai-tools.generated.ts`

New additive generated artifact:

- `ai-agents.generated.ts`

Generator behavior:

- scan module roots for `ai-agents.ts`
- emit `ai-agents.generated.ts` in `apps/mercato/.mercato/generated/`
- keep `ai-tools.generated.ts` format unchanged
- no new generated route files in v1 because the HTTP layer uses a dispatcher route

### Current-State Alignment
Before shipping the new runtime, Phase 0 must resolve the current mismatch between generated `ai-tools.generated.ts` output and current runtime loading behavior.

Required fix:

- restore or replace module-tool loading so generated `ai-tools.ts` contributions are actually available to the runtime again
- preserve the existing `mcp-tool-adapter.ts` path as the foundation for AI SDK-native tool resolution instead of replacing it with a second adapter stack
- reuse existing attachments endpoints and storage records as the single source of truth for file uploads, previews, OCR, and transfer

This is a prerequisite for the new focused-agent stack because agents depend on module-owned tool discovery.

## Data Models

V1 introduces no new database tables.

Persistent sources reused in v1:

- tenant AI settings from the current `ai_assistant` settings/config source
- uploaded files from the attachments module

Generated/runtime-only models:

### `AiToolDefinition`
- MCP-compatible public tool definition
- optional additive metadata for focused-agent runtime

### `AiAgentDefinition`
- declarative module-owned focused-agent definition
- generated into `ai-agents.generated.ts`

### `AiUiPart`
```ts
type AiUiPart = {
  componentId: string
  props: Record<string, unknown>
}
```

### `AiChatRequestContext`
```ts
type AiChatRequestContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string
  features: string[]
  isSuperAdmin: boolean
}
```

### `AiResolvedAttachmentPart`
```ts
type AiResolvedAttachmentPart = {
  attachmentId: string
  fileName: string
  mediaType: string
  source: 'bytes' | 'signed-url' | 'text' | 'metadata-only'
  textContent?: string | null
  url?: string | null
  data?: Uint8Array | string | null
}
```

Rules:

- images and PDFs should prefer `bytes` or short-lived `signed-url` sources depending on provider support
- text-like files should include extracted `textContent`
- unsupported binary files must still surface filename, media type, and size to the model/runtime

## API Contracts

### 1. Focused Agent Chat
`POST /api/ai/chat?agent=<module>.<agent>`

Auth:

- `requireAuth: true`
- route-level `requireFeatures: ['ai_assistant.view']`
- resolved agent `requiredFeatures` enforced at runtime

Request body:

```ts
type AiChatRequest = {
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
  }>
  attachmentIds?: string[]
  debug?: boolean
  pageContext?: {
    pageId?: string
    entityType?: string
    recordId?: string
  }
}
```

Rules:

- `messages` are required
- `attachmentIds` must belong to the authenticated tenant/org scope
- client may send `pageContext`; if the agent declares `resolvePageContext`, the runtime calls it to hydrate rich record-level context into the system prompt — otherwise `pageContext` is treated as advisory context only
- route requests must remain compatible with AI SDK chat transports by accepting request-level body fields without requiring transcript mutation

Response:

- streamed response in AI SDK-compatible format
- text parts plus structured UI parts
- terminal error messages must be serializable and user-safe

Error model:

- `401` unauthenticated
- `403` missing `ai_assistant.view` or missing agent feature access
- `404` unknown agent
- `400` invalid payload or invalid attachment IDs
- `409` agent/tool policy violation
- `500` internal runtime failure

### 2. AI SDK Helper Contracts
These are additive public APIs, not HTTP endpoints:

```ts
type RunAiAgentTextInput = {
  agentId: string
  messages: UIMessage[]
  attachmentIds?: string[]
  pageContext?: {
    pageId?: string
    entityType?: string
    recordId?: string
  }
  debug?: boolean
}

type RunAiAgentObjectInput<TSchema> = {
  agentId: string
  input: string | UIMessage[]
  attachmentIds?: string[]
  pageContext?: {
    pageId?: string
    entityType?: string
    recordId?: string
  }
  output?: TSchema
  debug?: boolean
}
```

Rules:

- `runAiAgentText()` maps to the same runtime policy as the HTTP chat route
- `runAiAgentObject()` is the Vercel AI SDK-friendly entry point for structured-output agents
- object helpers must use the same tool filtering, prompt composition, and attachment conversion path as chat helpers

### 3. Existing Routes Preserved
These remain supported and unchanged by this spec:

- `POST /api/chat`
- `GET /api/tools`
- `POST /api/tools/execute`

## UI/UX

### `<AiChat>`
Proposed props:

```ts
type AiChatProps = {
  agentId: string
  title?: string
  placeholder?: string
  debug?: boolean
  pageContext?: {
    pageId?: string
    entityType?: string
    recordId?: string
  }
  className?: string
}
```

Behavior:

- user enters text and optionally uploads attachments
- component uploads files through existing attachment flows
- chat request sends `attachmentIds`
- streamed text renders in the transcript
- streamed UI parts render through a client-side registry
- debug panel is opt-in and hidden by default
- component should expose request-level `body`/context configuration so pages can pass `pageContext`, selected agent settings, or prompt-override ids the same way AI SDK transports pass custom body fields

UX rules:

- all user-facing strings must be i18n-backed
- loading state uses shared UI conventions
- error state must show retry
- `Enter` sends when not in multiline mode
- `Cmd/Ctrl+Enter` always sends
- `Escape` closes any open attachment/secondary dialog
- use shared `Button` / `IconButton` primitives only

Initial streamable UI parts for v1:

- `record-card`
- `list-summary`
- `warning-note`

These are client-rendered components registered in the UI package.

### Playground and Settings Pages
Add two backend pages under AI Assistant configuration:

- `/backend/config/ai-assistant/playground`
- `/backend/config/ai-assistant/agents`

Playground requirements:

- selectable agent picker including general agent, customers agents, and catalog agents
- transcript mode and object-output mode
- attachment upload and preview support
- debug event stream and tool-call inspection
- quick page-context injection form for testing `resolvePageContext`

Settings requirements:

- prompt override editor
- tool-pack visibility toggles
- model override display and edit surface
- attachment policy summary
- saved test snippets / reusable context blocks for admins

## Access Control

### Route-Level
- `ai_assistant.view` is still the base feature for access to AI surfaces

### Agent-Level
- each `AiAgentDefinition` may declare `requiredFeatures`
- feature checks must use wildcard-aware matching

### Tool-Level
- existing `requiredFeatures` on tools remain authoritative
- agent runtime must intersect agent whitelist with tool ACL

### Mutation Policy
- v1 focused agents are read-only by default
- tools marked `isMutation: true` are blocked from read-only agents
- mutation-capable focused agents require a follow-up spec defining shared confirmation semantics

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Tool contract drift across MCP, in-process, and AI SDK adapters | High | AI runtime, security, behavior | One canonical builder, one `executeTool()` path, cross-surface contract tests | Medium |
| Current `ai-tools.generated.ts` vs runtime-loading mismatch remains unresolved | High | Existing module tools, new focused agents | Fix current loading in Phase 0 before any new agent work | Low |
| Tenant context leakage through attachment IDs | High | Security, privacy | Validate every attachment against tenant/org scope before model invocation | Low |
| Private attachment URLs are passed directly to providers and fail or leak | High | Security, attachment usability | Convert attachments to bytes, signed URLs, or extracted text in one runtime bridge | Low |
| Provider/model drift across tenants | Medium | Runtime config | Reuse existing tenant settings and only allow `defaultModel` override in v1 | Low |
| UI part registry grows into unstable mini-framework | Medium | UI maintainability | Ship a very small v1 registry with strict serializable props only | Low |
| Pressure to allow write-capable focused agents too early | High | Data integrity, UX safety | Keep v1 focused agents read-only; follow-up spec for confirmation protocol | Medium |
| `resolvePageContext` leaks cross-tenant data | High | Security, privacy | Resolver runs inside the same request-scoped context with tenant/org filters; validate resolver output does not include cross-tenant references | Low |
| Routing metadata (`keywords`/`domain`) used for auto-selection prematurely | Medium | UX correctness | V1 ignores routing metadata at runtime; only emitted in generated registry for future use | Low |
| Model factory env overrides bypass tenant settings silently | Medium | Runtime config, billing | Document env override precedence clearly; log which resolution path was used in debug mode | Low |
| Tenant prompt overrides can weaken safety instructions | High | Security, mutation safety | Keep hard safety sections server-owned and append tenant overrides after them | Low |
| Tool coverage stops at CRUD and misses UI-level read models | Medium | UX usefulness | Require aggregate detail tools that mirror real tabs/panels for customers and catalog | Low |

## Phasing

### Phase 0 - Alignment and Foundations
Goal: align the current tool runtime with generator output and add additive contracts.

Deliverables:

- restore module-tool loading from generated `ai-tools.generated.ts`
- add `defineAiTool()` as an additive helper
- add `AiAgentDefinition` and `ai-agents.ts` generator support
- emit new `ai-agents.generated.ts`

### Phase 1 - Tool Packs and AI SDK DX
Goal: make the platform actually useful to Vercel AI SDK users and ship the baseline tool packs before polishing UI chrome.

Deliverables:

- add agent registry/runtime
- add `POST /api/ai/chat?agent=...`
- add AI SDK helper adapters (`createAiAgentTransport`, `resolveAiAgentTools`, `runAiAgentText`, `runAiAgentObject`)
- implement general-purpose tool packs plus the initial customers and catalog tool packs
- add attachment-to-model conversion bridge
- authenticate with standard route auth and AI SDK helper contexts

### Phase 2 - Playground, Settings, and First Module Agents
Goal: ship the admin-facing surfaces that make the system testable and configurable.

Deliverables:

- add `<AiChat>`
- tagged streamed UI parts
- add playground page with agent picker, chat mode, object mode, and debug panel
- add settings page with prompt overrides, tool toggles, and attachment policy visibility
- ship first customers and catalog module agents using the new tool packs

### Phase 3 - Production Hardening and Expansion
Goal: prove the design on real production agents and harden the customization model.

Candidate:

- `inbox_ops.proposal_assistant`
- `sales.order_assistant`
- `customers.account_assistant`
- `catalog.merchandising_assistant`

Deliverables:

- one or more real `ai-agents.ts` files with `resolvePageContext` implementation
- structured prompt templates and versioned tenant overrides
- shared model factory utility extracted from `inbox_ops/lib/llmProvider.ts` into `@open-mercato/ai-assistant`, supporting `defaultModel` override and optional env-based per-agent override (`<MODULE>_AI_MODEL`)
- integration coverage

### Phase 4 - Follow-up Scope
Out of scope for this spec but expected follow-ups:

- mutation-capable focused agents with shared confirmation protocol
- per-module MCP endpoints
- agent-to-agent composition
- RSC `streamUI`
- agent-suggestion feature consuming `keywords`, `domain`, and `dataCapabilities` metadata
- context dependencies for auto-resolving tool whitelists from module affinities
- execution budgets (`maxSteps`) recommended as mandatory for mutation-capable agents
- versioned manifest contract (`manifestVersion`, `platformRange`) when external modules ship AI agents

## Implementation Plan

### Phase 0
1. Add `AiAgentDefinition` type and export it from `@open-mercato/ai-assistant`.
2. Add `defineAiTool()` helper that returns `AiToolDefinition`.
3. Add generator extension for `ai-agents.ts` and emit `ai-agents.generated.ts`.
4. Restore loading of generated `ai-tools.generated.ts` contributions in the runtime.
5. Add tests proving existing `ai-tools.ts` modules still register and execute.
6. Add the attachment bridge contract types and prompt composition primitives.

### Phase 1
1. Add `agent-registry.ts` that loads `ai-agents.generated.ts`.
2. Add runtime policy checks for `requiredFeatures`, `allowedTools`, `readOnly`, attachment access, and `executionMode`.
3. Add `api/ai/chat/route.ts` with `metadata` and `openApi`.
4. Add AI SDK helper adapters and transport helpers.
5. Implement general-purpose tool packs plus customers/catalog tool packs that mirror existing UI read models and write operations.
6. Add contract tests for unknown agent, forbidden agent, invalid attachment, allowed-tool filtering, and object-agent execution.

### Phase 2
1. Add `packages/ui/src/ai/AiChat.tsx`.
2. Add upload adapter that reuses attachment APIs and returns `attachmentIds`.
3. Add a minimal client-side UI-part registry.
4. Add backend playground page and agent settings page.
5. Add backend and portal examples using existing injection/replacement patterns.
6. Add i18n strings and keyboard interaction coverage.
7. Ship first customers and catalog module agents with prompt templates.

### Phase 3
1. Extract shared model factory from `inbox_ops/lib/llmProvider.ts` into `@open-mercato/ai-assistant/lib/model-factory.ts`. Support `defaultModel` override and env-based per-agent override (`<MODULE>_AI_MODEL`).
2. Implement production `ai-agents.ts` files with `resolvePageContext` callbacks that hydrate record-level context.
3. Add versioned prompt override persistence and safe additive merge rules.
4. Bind production agents to existing backend pages through normal injection/UI composition, passing `pageContext` from the page.
5. Add focused integration tests covering page context resolution, model factory fallback chain, and tenant prompt overrides.
6. Add docs.

## Integration Test Coverage

Required coverage for this spec:

### API
- authenticated user with `ai_assistant.view` can call `/api/ai/chat` for an allowed agent
- user without `ai_assistant.view` gets `403`
- user without agent `requiredFeatures` gets `403`
- unknown `agent` gets `404`
- attachment from another tenant/org is rejected
- read-only agent cannot access a mutation-marked tool
- tool whitelist is enforced even if the tool exists globally
- object-mode agent can execute through the public helper with the same policy checks as chat-mode agents
- custom request body fields propagate page context without altering the transcript

### UI
- `<AiChat>` uploads files and sends `attachmentIds`
- streamed text renders progressively
- tagged UI parts render using the registry
- debug panel remains hidden unless enabled
- keyboard shortcuts work
- i18n keys resolve correctly
- playground page can switch between general, customers, and catalog agents
- settings page persists additive prompt overrides without mutating hard safety sections

### Tool Coverage
- general search tool pack can reach fulltext, vector, and token-backed search results
- customers tool pack can read the same aggregates shown on person, company, and deal pages
- catalog tool pack can read the same aggregates shown on product and category pages
- write tools map to the same command-backed operations already exposed by UI forms and actions

### Page Context Resolution
- agent with `resolvePageContext` receives hydrated context when `pageContext` includes `entityType` and `recordId`
- agent without `resolvePageContext` treats `pageContext` as advisory only
- `resolvePageContext` errors are caught and do not crash the chat request

### Model Factory
- model factory resolves per-agent env override when set
- model factory falls back to `defaultModel` when no env override exists
- model factory falls back to tenant settings when no `defaultModel` is declared

### Execution Budget
- agent with `maxSteps` stops after the declared number of tool-call steps
- agent without `maxSteps` uses the runtime default

### Backward Compatibility
- existing `ai-tools.ts` modules still load
- `ai-tools.generated.ts` output shape remains unchanged
- `registerMcpTool()` still works
- existing `/api/chat` and `/api/tools*` routes still function
- existing `mcp:serve` and `mcp:serve-http` commands still function
- current OpenCode Code Mode behavior remains available alongside the new agents

## Migration & Backward Compatibility

This spec modifies public AI extension surfaces and therefore must remain additive.

### Frozen surfaces kept intact
- `ai-tools.ts`
- `AiToolDefinition`
- `McpToolDefinition`
- `registerMcpTool()`
- `ai-tools.generated.ts`
- `POST /api/chat`
- `GET /api/tools`
- `POST /api/tools/execute`
- `mcp:serve`
- `mcp:serve-http`

### Additive surfaces introduced
- `ai-agents.ts`
- `AiAgentDefinition` (with optional `executionMode`, `output`, `resolvePageContext`, `maxSteps`, `keywords`, `domain`, `dataCapabilities`)
- `defineAiTool()`
- `ai-agents.generated.ts`
- `POST /api/ai/chat?agent=...`
- `<AiChat>`
- `createAiAgentTransport(...)`
- `resolveAiAgentTools(...)`
- `runAiAgentText(...)`
- `runAiAgentObject(...)`
- attachment bridge helpers for AI SDK file/text parts
- playground and agent settings pages
- shared model factory (`@open-mercato/ai-assistant/lib/model-factory.ts`, Phase 3)

### Rules
- no existing import path is removed or renamed
- no existing generated output is renamed or removed
- no existing route is removed or repurposed
- no existing CLI command is removed or renamed
- new optional fields added to tool definitions must not break existing plain object tool definitions

### Release Notes
When implemented, release notes must call out:

- new `ai-agents.ts` convention
- new `defineAiTool()` helper
- new `/api/ai/chat` route
- new AI SDK helper adapters for chat and structured-output flows
- new playground and agent settings pages
- coexistence story with OpenCode and Command Palette

## Final Compliance Report

| Check | Status | Notes |
|------|--------|-------|
| Existing public AI contracts preserved | Pass | All existing contracts remain additive-only |
| New convention file is additive | Pass | `ai-agents.ts` added without replacing `ai-tools.ts` |
| Route auth defined | Pass | Standard auth plus agent feature checks |
| Generator impact specified | Pass | New `ai-agents.generated.ts`, old `ai-tools.generated.ts` preserved |
| UI conventions covered | Pass | i18n, keyboard, shared buttons, debug defaults specified |
| Mutation safety addressed | Pass | V1 focused agents are read-only |
| Integration tests defined | Pass | API, UI, and BC coverage listed |
| Risks include failure scenarios and mitigations | Pass | Concrete table included |

## Changelog

### 2026-04-15
- Integrated high-value ideas from PR #1222 analysis (`.ai/specs/2026-04-13-pr-1222-decentralized-ai-analysis.md`).
- Added `resolvePageContext` callback to `AiAgentDefinition` for module-owned page context hydration (Phase 3).
- Added `maxSteps` execution budget field to `AiAgentDefinition` (Phase 1+, recommended for Phase 4 mutation agents).
- Added routing metadata fields (`keywords`, `domain`, `dataCapabilities`) to `AiAgentDefinition` for future agent-suggestion (Phase 4+).
- Added AI SDK-first adapter requirements so Open Mercato agents can be used through chat transports and structured-output helper flows without custom glue code.
- Added `executionMode` / `output` planning to make object-style agents first-class for Vercel AI SDK users.
- Added explicit attachment-to-model conversion rules covering images, PDFs, text-like files, and unsupported binaries.
- Added general-purpose tool packs plus customers/catalog coverage requirements derived from real UI and API surfaces in the repo.
- Added playground and agent settings pages to the planned surface area.
- Moved tool implementation to the next delivery phase and split the remainder into tooling, playground/settings, and production-hardening phases.
- Added shared model factory consolidation to Phase 3 deliverables.
- Expanded follow-up scope with context dependencies and versioned manifest contract.
- Added Decision D11 documenting community-sourced enhancements and their adoption timeline.
- Added integration test coverage for AI SDK helper flows, playground/settings behavior, customers/catalog tool packs, page context resolution, model factory, and execution budgets.
- Added risk entries for private attachment URL leakage, tenant prompt overrides, `resolvePageContext` tenant isolation, routing metadata premature use, and model factory env overrides.
- Credit: ideas sourced from @rchrzanwlc's research in PR #1222.

### 2026-04-11
- Replaced the skeleton with an implementation-ready additive migration spec.
- Resolved the architecture questions in favor of low-BC-risk choices.
- Added architecture, data model, API contract, UI/UX, risk, migration, and integration-test sections.
- Explicitly preserved current MCP, generated-file, route, and CLI contracts.
