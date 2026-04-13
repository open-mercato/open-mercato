# Unified AI Tooling, Module Sub-Agents & Embeddable Chat

## TLDR
- Add an additive AI runtime on top of the existing `@open-mercato/ai-assistant` package so modules can expose focused sub-agents and embeddable chat without breaking current MCP, OpenCode, or Command Palette behavior.
- Keep `ai-tools.ts`, `AiToolDefinition`, `McpToolDefinition`, `registerMcpTool()`, `ai-tools.generated.ts`, `/api/chat`, `/api/tools`, `mcp:serve`, and `mcp:serve-http` working unchanged.
- Introduce a new additive module convention, `ai-agents.ts`, plus a reusable `<AiChat>` UI component and a new authenticated dispatcher route, `POST /api/ai/chat?agent=<module>.<agent>`.
- V1 ships focused, read-first sub-agents, standard auth, attachment-backed uploads, tagged client-rendered streamed UI parts, and explicit coexistence with OpenCode Code Mode.

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

This specification adds those capabilities without replacing the current stack. OpenCode remains the general assistant. The new stack is for narrow, module-scoped AI features.

## Problem Statement
The current AI stack is powerful but optimized for a general assistant, not embedded product workflows.

Current limitations:

- Module-owned focused agents do not exist as first-class artifacts. A module can expose tools, but not a complete "orders assistant" or "inbox proposal assistant" with an owned prompt, media policy, and tool whitelist.
- The current UI surface is centered on the Command Palette. There is no reusable `<AiChat>` component that a page can embed and bind to a specific agent.
- The current `/api/chat` route is designed around OpenCode and its session/question protocol. It is not the right contract for module-specific agent endpoints.
- The current MCP/runtime story is internally inconsistent: the generator still emits `ai-tools.generated.ts`, but current tool loading logic is Code Mode-centric. That mismatch must be resolved before adding more AI extension surfaces.
- Mutation safety for focused AI workflows is not formalized outside the existing OpenCode question flow.

Non-goals for this spec:

- Replacing OpenCode.
- Removing or renaming existing MCP routes, chat routes, commands, or generated files.
- Introducing a new top-level package such as `@open-mercato/ai`.
- Per-module MCP endpoints in v1.
- RSC `streamUI` in v1.

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
- `packages/ai-assistant/src/modules/ai_assistant/lib/ai-tool-definition.ts`
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`
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
  systemPrompt: string
  allowedTools: string[]
  defaultModel?: string
  acceptedMediaTypes?: Array<'image' | 'pdf' | 'file'>
  requiredFeatures?: string[]
  uiParts?: string[]
  readOnly?: boolean
}
```

Rules:

- `id` format: `<module>.<agent>`
- `allowedTools` is an explicit whitelist
- `readOnly` defaults to `true` in v1
- if `readOnly` is `true`, tools marked `isMutation: true` are rejected at registration/runtime
- focused agents may call other focused agents only in a later phase; v1 agents only call tools

### 3. Standard Agent Runtime
Add an internal focused-agent runtime that:

- resolves the agent definition from the generated registry
- authenticates with standard Open Mercato auth
- creates a request-scoped execution context
- resolves whitelisted tools from the shared tool registry
- adapts those tools to AI SDK tool execution using the same handler/ACL contract
- streams text and tagged UI parts back to the client

Important constraint:

- this is an internal runtime optimization, not a new public module-authoring contract
- module authors still author MCP-compatible tools and declarative agent definitions

### 4. Embeddable `<AiChat>`
Add a reusable UI component for backend and portal pages.

Supported bindings:

- `agentId="<module>.<agent>"`
- future `tools=[...]` freeform mode is out of scope for v1

Supported media:

- text
- image attachments
- PDF attachments
- generic file attachments already supported by the attachments module

### 5. Safe V1 Scope
V1 focused agents are read-first.

Rules:

- agent-bound chat may use only read-only tools in v1
- mutation-capable tools remain available through the existing general assistant/MCP flows
- mutation-capable focused agents are deferred to a later follow-up spec once confirmation semantics are unified

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

5. HTTP/UI layer
   - `POST /api/ai/chat?agent=...`
   - `<AiChat>`

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
- client may send `pageContext`, but server treats it as advisory context only

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

### 2. Existing Routes Preserved
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
| Provider/model drift across tenants | Medium | Runtime config | Reuse existing tenant settings and only allow `defaultModel` override in v1 | Low |
| UI part registry grows into unstable mini-framework | Medium | UI maintainability | Ship a very small v1 registry with strict serializable props only | Low |
| Pressure to allow write-capable focused agents too early | High | Data integrity, UX safety | Keep v1 focused agents read-only; follow-up spec for confirmation protocol | Medium |

## Phasing

### Phase 0 - Alignment and Foundations
Goal: align the current tool runtime with generator output and add additive contracts.

Deliverables:

- restore module-tool loading from generated `ai-tools.generated.ts`
- add `defineAiTool()` as an additive helper
- add `AiAgentDefinition` and `ai-agents.ts` generator support
- emit new `ai-agents.generated.ts`

### Phase 1 - Agent Runtime and Authenticated Dispatcher
Goal: introduce the focused-agent runtime and HTTP entrypoint.

Deliverables:

- add agent registry/runtime
- add `POST /api/ai/chat?agent=...`
- authenticate with standard route auth
- adapt whitelisted tools into AI SDK execution

### Phase 2 - Embeddable UI
Goal: ship the reusable chat UI.

Deliverables:

- add `<AiChat>`
- attachment-backed upload flow
- tagged streamed UI parts
- debug panel

### Phase 3 - First Production Agent
Goal: prove the design on one real module-owned focused agent.

Candidate:

- `inbox_ops.proposal_assistant` or `sales.order_assistant`

Deliverables:

- one real `ai-agents.ts`
- one whitelisted read-only tool set
- integration coverage

### Phase 4 - Follow-up Scope
Out of scope for this spec but expected follow-ups:

- mutation-capable focused agents with shared confirmation protocol
- per-module MCP endpoints
- agent-to-agent composition
- RSC `streamUI`

## Implementation Plan

### Phase 0
1. Add `AiAgentDefinition` type and export it from `@open-mercato/ai-assistant`.
2. Add `defineAiTool()` helper that returns `AiToolDefinition`.
3. Add generator extension for `ai-agents.ts` and emit `ai-agents.generated.ts`.
4. Restore loading of generated `ai-tools.generated.ts` contributions in the runtime.
5. Add tests proving existing `ai-tools.ts` modules still register and execute.

### Phase 1
1. Add `agent-registry.ts` that loads `ai-agents.generated.ts`.
2. Add runtime policy checks for `requiredFeatures`, `allowedTools`, `readOnly`, and attachment access.
3. Add `api/ai/chat/route.ts` with `metadata` and `openApi`.
4. Reuse existing auth/context resolution for route and in-process execution.
5. Add contract tests for unknown agent, forbidden agent, invalid attachment, and allowed-tool filtering.

### Phase 2
1. Add `packages/ui/src/ai/AiChat.tsx`.
2. Add upload adapter that reuses attachment APIs and returns `attachmentIds`.
3. Add a minimal client-side UI-part registry.
4. Add backend and portal examples using existing injection/replacement patterns.
5. Add i18n strings and keyboard interaction coverage.

### Phase 3
1. Implement one production `ai-agents.ts`.
2. Bind it to an existing backend page through normal injection/UI composition.
3. Add focused integration tests and docs.

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

### UI
- `<AiChat>` uploads files and sends `attachmentIds`
- streamed text renders progressively
- tagged UI parts render using the registry
- debug panel remains hidden unless enabled
- keyboard shortcuts work
- i18n keys resolve correctly

### Backward Compatibility
- existing `ai-tools.ts` modules still load
- `ai-tools.generated.ts` output shape remains unchanged
- `registerMcpTool()` still works
- existing `/api/chat` and `/api/tools*` routes still function
- existing `mcp:serve` and `mcp:serve-http` commands still function

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
- `AiAgentDefinition`
- `defineAiTool()`
- `ai-agents.generated.ts`
- `POST /api/ai/chat?agent=...`
- `<AiChat>`

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

### 2026-04-11
- Replaced the skeleton with an implementation-ready additive migration spec.
- Resolved the architecture questions in favor of low-BC-risk choices.
- Added architecture, data model, API contract, UI/UX, risk, migration, and integration-test sections.
- Explicitly preserved current MCP, generated-file, route, and CLI contracts.
