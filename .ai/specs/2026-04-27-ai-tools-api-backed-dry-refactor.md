# API-Backed AI Tool DRY Refactor

**Date:** 2026-04-27  
**Status:** Draft  
**Scope:** OSS, `@open-mercato/ai-assistant`, `customers`, `catalog`

## TLDR

The AI framework unification PR adds useful typed module agents, but many new `customers` and `catalog` AI tools duplicate API route and command logic that is already tested through CRUD routes, query engine filters, custom-field decoration, encryption helpers, mutation guards, command handlers, events, cache invalidation, and OpenAPI coverage.

Refactor the new AI framework/tool code by introducing a small in-process API-operation adapter and migrating duplicated tool handlers to reuse existing API route contracts without an HTTP round trip. Keep current AI tool names, schemas, agent allowlists, pending-action behavior, APIs, commands, event IDs, ACL feature IDs, and database schema unchanged.

## Overview

The current PR correctly keeps focused agents additive, but the first production tool packs drift from the platform's established API surface:

- read tools rebuild list filters and response shapes by hand
- detail tools manually assemble related records and custom fields
- mutation tools call commands directly from AI handlers, duplicating API-side payload normalization and scoped command context construction
- Code Mode already has an `api.request()` capability backed by OpenAPI/RBAC checks, but typed tools need the same DRY behavior without paying the HTTP/fetch cost or running a second AI-tool authorization pass

This spec proposes a narrow refactor that makes the existing API the source of truth for AI tools while preserving typed, curated tools as the model-facing UX.

Market reference: Vercel AI SDK and OpenAPI tool generation patterns both separate "tool contract for the model" from "transport/client that executes existing application capabilities." Adopt that split. Reject fully generated tool exposure for production module agents because curated tool names and schemas are still better for model behavior and approval UX.

## Problem Statement

The branch introduces a second implementation path for core business behavior:

- `customers.list_people`, `customers.list_deals`, `catalog.list_products`, and similar tools manually rebuild list filters already owned by CRUD APIs.
- `customers.get_person`, `customers.get_deal`, `catalog.get_product`, and merchandising detail tools manually query related records that backend pages and APIs already expose or can compose from existing APIs.
- `catalog.update_product`, `catalog.bulk_update_products`, `catalog.apply_attribute_extraction`, and `customers.update_deal_stage` correctly use commands eventually, but they bypass the API route layer that owns request normalization, route metadata, OpenAPI contract, and guard wiring.
- `catalog.update_product_media_descriptions` is an AI-only direct ORM write because there is no existing API/command for that exact operation.

The risk is not immediate BC breakage. The risk is long-term behavioral drift: filters, custom fields, search token behavior, cache invalidation assumptions, validation messages, and mutation guard behavior can diverge between "normal UI/API" and "AI tool" paths.

## Proposed Solution

Add one small in-process operation helper and migrate only new AI tool handlers:

1. Add `createAiApiOperationRunner(ctx)` in `@open-mercato/ai-assistant`. It resolves generated API route metadata and executes the route handler in-process with the already-authenticated AI tool context.
2. Add `defineApiBackedAiTool(...)` as optional sugar over `defineAiTool(...)`.
3. Replace duplicated read handlers with thin API compositions:
   - list tools call existing `GET /api/...` list endpoints
   - detail tools call list/detail-equivalent API paths with `ids`/`id` filters plus related list APIs where needed
   - tool outputs keep their current stable AI-facing shape through small mapper functions
4. Replace mutation handlers' direct command execution with in-process API operation calls executed only after pending-action confirmation.
5. Leave APIs and commands untouched unless a tool currently has no existing API/command equivalent; for those, mark them as explicit exceptions and keep the current handler until a separate API-first spec creates the missing capability.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Keep curated AI tools | Model-facing names like `catalog.get_product_bundle` and `catalog.bulk_update_products` are better than exposing raw CRUD endpoints directly. |
| API route contract becomes execution source of truth | Existing API tests already cover query filters, scoped payload normalization, custom fields, OpenAPI, and command dispatch. |
| In-process execution, no HTTP | Avoids loopback fetch latency, serialization overhead, server URL config, and extra network failure modes. |
| No second authorization pass | The AI runtime already gates tools by `requiredFeatures`, agent allowlists, read-only/mutation policy, and pending-action confirmation. The runner validates route existence/contract but trusts the AI tool context for auth. |
| Add helpers mainly in `ai-assistant` | The duplication was introduced by the new AI framework. Any shared/core changes should be tiny, additive hooks needed only to pass a trusted auth context into existing route logic. |
| Preserve tool output shape | Agents, tests, and UI parts should not need prompt or component rewrites. |
| Keep pending-action contract | API-backed mutation execution happens from the existing confirm path, never directly from model tool calls. |
| No new database tables | This is a refactor of execution plumbing only. |

## Architecture

### Current Flow

```text
Typed AI tool -> custom handler -> ORM / query engine / command bus
```

### Target Flow

```text
Typed AI tool -> mapper -> createAiApiOperationRunner(ctx).run() -> existing API route logic -> command/query engine
```

For mutation tools:

```text
model tool call -> prepareMutation stores input + preview snapshot
Confirm -> pending-action executor -> tool handler -> in-process API operation -> command
```

The helper should reuse Code Mode's endpoint discovery and request normalization ideas, but not its HTTP transport and not its full authorization decision:

- endpoint must exist in OpenAPI/discovery
- route metadata/OpenAPI must exist for contract visibility
- endpoint-level `requiredFeatures` are treated as a consistency assertion against the tool's own `requiredFeatures`, not as a second RBAC lookup
- mutation endpoints without declared required features still fail closed unless the tool explicitly opts into a documented exception
- tenant and organization context are injected from the already-authenticated AI tool context
- no `fetch()`, no loopback URL, no API key/cookie reconstruction

### Auth Boundary

Typed AI tools already pass through the AI runtime policy gate before a handler runs:

- agent exists and is enabled
- tool is in the agent `allowedTools`
- caller has the tool `requiredFeatures`
- read-only/mutation policy allows the tool
- mutation tools are converted to pending actions and run only after confirm

The operation runner must not repeat that authorization path. It should only fail closed when the target route has no contract metadata or when the route's declared feature requirements are incompatible with the tool declaration. This keeps the operation fast and avoids two sources of authorization truth.

### New Helper Surface

```typescript
type AiApiOperationRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: Record<string, unknown>
}

type AiApiOperationResponse<T = unknown> = {
  success: boolean
  statusCode: number
  data?: T
  error?: string
  details?: unknown
}

function createAiApiOperationRunner(ctx: AiToolExecutionContext): {
  run<T = unknown>(request: AiApiOperationRequest): Promise<AiApiOperationResponse<T>>
}

function defineApiBackedAiTool<TInput, TApi, TOutput>(config: {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures: string[]
  isMutation?: boolean
  toOperation(input: TInput, ctx: AiToolExecutionContext): AiApiOperationRequest | Promise<AiApiOperationRequest>
  mapResponse(response: AiApiOperationResponse<TApi>, input: TInput, ctx: AiToolExecutionContext): TOutput | Promise<TOutput>
  loadBeforeRecord?: AiToolDefinition['loadBeforeRecord']
  loadBeforeRecords?: AiToolDefinition['loadBeforeRecords']
}): AiToolDefinition
```

`defineApiBackedAiTool` is optional. Tools with complex composition may directly use `createAiApiOperationRunner(ctx)`.

## Data Models

No new entities and no migrations.

Existing `AiPendingAction` records continue storing the same payloads. If an API-backed mutation returns API response metadata, store it inside the existing pending-action result envelope only; do not add columns.

## API Contracts

No existing API routes change.

The refactor consumes current contracts, primarily:

- `GET /api/customers/people`
- `GET /api/customers/companies`
- `GET /api/customers/deals`
- `GET /api/customers/activities`
- `GET /api/customers/todos`
- `GET /api/customers/addresses`
- `GET /api/customers/tags`
- `PUT /api/customers/deals`
- `GET /api/catalog/products`
- `PUT /api/catalog/products`
- `GET /api/catalog/categories`
- `GET /api/catalog/variants`
- `GET /api/catalog/prices`
- `GET /api/catalog/offers`
- `GET /api/catalog/product-media` or the existing attachments API path used for product media, if that is the current documented route
- `GET /api/catalog/price-kinds`
- `GET /api/catalog/option-schemas`
- `GET /api/catalog/product-unit-conversions`

If a needed route is not documented in OpenAPI, the tool must not call it through the new helper until the route exports `openApi`. That keeps the Code Mode fail-closed rule consistent.

## Migration & Compatibility

- Tool names remain unchanged.
- `defineAiTool(...)` remains unchanged.
- `AiToolDefinition` remains additive-only.
- Agent `allowedTools` arrays remain unchanged.
- API URLs, command IDs, event IDs, ACL feature IDs, generated file conventions, and database schema remain unchanged.
- Existing API clients remain unaffected.
- Existing tests for commands and APIs continue to be authoritative.
- AI tool tests should be updated to assert delegation/mapping instead of duplicating route behavior.

This is backward compatible because it narrows implementation internals without changing any public contract.

## Implementation Plan

### Phase 1: Add In-Process API Operation Runner

1. Add `packages/ai-assistant/src/modules/ai_assistant/lib/ai-api-operation-runner.ts`.
2. Resolve the generated API route manifest (`api-routes.generated.ts`) and invoke the matched route handler in-process.
3. Pass trusted AI tool auth context into the operation path instead of reconstructing cookies/API keys or performing a second RBAC lookup.
4. Keep Code Mode on its current HTTP-style `api.request()` initially unless it can use the runner without changing public behavior; typed tools are the priority.
3. Add unit tests for:
   - documented route can be resolved and invoked in-process
   - undocumented endpoint rejected
   - mutation endpoint without route feature metadata rejected unless explicitly excepted
   - tenant/org/user context is passed from the AI tool context
   - no `fetch()` call is made
   - API error response normalization

### Phase 2: Add API-Backed Tool Helper

1. Add `defineApiBackedAiTool(...)` in `agent-tools.ts` or a sibling `api-backed-tool.ts`.
2. Export it from `@open-mercato/ai-assistant`.
3. Add mapper tests proving the helper preserves `requiredFeatures`, `isMutation`, `loadBeforeRecord(s)`, and serializable output.

### Phase 3: Migrate Read Tools

Start with the high-duplication tools:

1. `customers.list_people`, `customers.list_companies`, `customers.list_deals`
2. `catalog.list_products`, `catalog.list_categories`, `catalog.list_variants`, `catalog.list_prices`, `catalog.list_offers`
3. merchandising read tools that are pure projections of existing list/detail endpoints

Each tool should:

- parse the existing AI input schema
- call the matching API endpoint
- map API payload to the existing AI output shape
- keep any genuinely agent-specific aggregation in a small local composer

### Phase 4: Migrate Mutation Tools

1. Change `customers.update_deal_stage` confirmed execution to call `PUT /api/customers/deals`.
2. Change `catalog.update_product` confirmed execution to call `PUT /api/catalog/products`.
3. Change `catalog.bulk_update_products` to loop API calls inside the confirmed handler while preserving the current single pending action and per-record result array.
4. Change `catalog.apply_attribute_extraction` to call `PUT /api/catalog/products` with custom-field payload keys accepted by the existing API.
5. Keep `loadBeforeRecord(s)` local unless a documented API route already returns the exact preview snapshot cheaply.

### Phase 5: Document Exceptions

Document any tool that cannot be API-backed yet. Initial expected exception:

- `catalog.update_product_media_descriptions`: currently writes attachment `storageMetadata` directly because no documented attachment/media command exists for alt text/caption updates.

Do not add that missing API in this refactor. Create a separate small spec if product media metadata needs to become a first-class API/command operation.

## File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-api-operation-runner.ts` | Create | In-process API route operation runner for typed AI tools |
| `packages/ai-assistant/src/modules/ai_assistant/lib/codemode-tools.ts` | Optional Modify | Only if Code Mode can reuse the runner without public behavior changes |
| `packages/ai-assistant/src/modules/ai_assistant/lib/api-backed-tool.ts` | Create | Optional `defineApiBackedAiTool` helper |
| `packages/ai-assistant/src/index.ts` | Modify | Export helper(s) |
| `apps/mercato/src/app/api/[...slug]/route.ts` or shared route-dispatch helper | Optional Modify | Extract tiny in-process dispatch primitive if needed so AI and HTTP paths share route lookup semantics |
| `packages/shared/src/lib/crud/factory.ts` | Optional Modify | Additive support for trusted auth context if CRUD handlers cannot currently consume handler context directly |
| `packages/core/src/modules/customers/ai-tools/*.ts` | Modify | Replace duplicated handlers with API-backed wrappers/composers |
| `packages/core/src/modules/catalog/ai-tools/*.ts` | Modify | Replace duplicated handlers with API-backed wrappers/composers |
| `packages/core/src/modules/*/__tests__/ai-tools/*.test.ts` | Modify | Test mapping/delegation and exception behavior |

## Testing Strategy

- Unit-test `createAiApiOperationRunner` against mocked route manifests and route handlers.
- Unit-test `defineApiBackedAiTool` wrapper behavior.
- Update customers/catalog AI tool tests to verify:
  - same tool names and schemas
  - same normalized outputs for representative API payloads
  - operation runner receives expected path/query/body
  - permission failures are surfaced cleanly
  - pending-action mutation confirmation still executes only after confirm
- Keep existing API route and command tests unchanged as the behavioral source of truth.
- Run affected AI assistant, customers, catalog unit tests.

## Risks & Impact Review

#### Operation Context Drift
- **Scenario**: The in-process runner passes tenant/org/user context differently from the HTTP API path.
- **Severity**: High
- **Affected area**: Typed AI tools
- **Mitigation**: Centralize context construction in the runner and test tenant/org/user propagation against representative CRUD routes.
- **Residual risk**: Low; behavior is already centralized after the refactor.

#### Hidden Second Authorization
- **Scenario**: The runner accidentally repeats route RBAC and disagrees with the AI tool policy gate.
- **Severity**: High
- **Affected area**: AI tool reliability and operator permissions
- **Mitigation**: Treat route features as metadata/contract assertions only. The AI runtime remains the single authorization source for typed tools.
- **Residual risk**: Low with tests proving no RBAC service lookup is required by the runner.

#### Tool Output Regression
- **Scenario**: API-backed wrappers return API-native snake_case payloads where agents/tests expect camelCase AI tool payloads.
- **Severity**: Medium
- **Affected area**: Agent prompts, tests, UI debug output
- **Mitigation**: Preserve existing AI output shape with explicit mapper functions and golden tests.
- **Residual risk**: Medium until all existing tool tests are migrated.

#### N+1 API Calls In Aggregated Detail Tools
- **Scenario**: A detail tool composes many related API calls and becomes slower than the direct ORM version.
- **Severity**: Medium
- **Affected area**: Agent latency for rich context
- **Mitigation**: Keep aggregation bounded by existing caps, prefer `ids` filters, and allow local composition only where it avoids repeated model-visible calls.
- **Residual risk**: Medium; acceptable because correctness/DRY is the primary goal and hot paths can later earn first-class aggregate APIs.

#### Missing API Coverage
- **Scenario**: A current AI-only capability has no documented API endpoint.
- **Severity**: Medium
- **Affected area**: Product media description writes and any similar AI-only actions
- **Mitigation**: Keep explicit exceptions in place. Do not expand this refactor into API design work.
- **Residual risk**: Medium; documented exceptions remain debt but are visible and isolated.

#### Pending-Action Semantics Change
- **Scenario**: Mutation handlers start performing API calls before confirmation.
- **Severity**: Critical
- **Affected area**: AI mutation safety
- **Mitigation**: Migrate only confirmed handler execution; keep `isMutation`, `prepareMutation`, preview cards, and confirm/cancel routes unchanged.
- **Residual risk**: Low with tests asserting no API write occurs during prepare.

## Final Compliance Report — 2026-04-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Keep code minimal and focused | Compliant | Changes are limited to new AI tool plumbing and new AI tool handlers. |
| root AGENTS.md | Backward compatibility for contract surfaces | Compliant | No route, command, event, feature, generated-file, or DB contract changes. |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | New runner refuses undocumented endpoints, reinforcing this rule. |
| packages/core/AGENTS.md | CRUD routes should use query engine and command-backed writes | Compliant | Existing APIs stay the source of truth. |
| packages/ai-assistant/AGENTS.md | AI tools must set `requiredFeatures` and use Zod | Compliant | Wrapper preserves current tool metadata and schemas. |
| packages/ai-assistant/AGENTS.md | Mutation tools must use pending-action approval | Compliant | In-process API-backed writes still execute only from confirmed pending actions. |
| catalog AGENTS.md | MUST NOT reimplement pricing logic | Improved | Product/price reads and writes stop reimplementing local price validation where existing APIs own it; missing coverage is documented separately. |
| customers AGENTS.md | Use CRUD/API and command patterns | Improved | AI tools reuse the customers API/command path instead of manual ORM copies. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data model changes. |
| API contracts match implementation plan | Pass | Existing API contracts are consumed, not modified. |
| Risks cover all write operations | Pass | Pending-action and missing API coverage risks are explicit. |
| Commands defined for all mutations | Partial | Existing product/deal mutations are command-backed through APIs; media metadata remains an exception. |
| Cache strategy covers read APIs | Pass | In-process API-backed tools reuse existing CRUD cache behavior where the route logic already applies it. |

### Non-Compliant Items

- **Rule**: Avoid AI-only write paths that bypass normal command validation and side effects.
- **Source**: `packages/ai-assistant/AGENTS.md`, root DRY/BC guidance.
- **Gap**: `catalog.update_product_media_descriptions` currently writes attachment metadata directly because no command/API exists.
- **Recommendation**: Keep it as a documented exception in this refactor; later add a small attachment/product-media metadata command + documented API route if the capability should ship broadly.

### Verdict

Approved for implementation as a minimal, BC-preserving refactor. The only known non-compliant item is intentionally out of scope and documented as follow-up debt.

## Changelog

### 2026-04-27

- Initial specification for replacing duplicated typed AI tool internals with in-process API-backed wrappers while keeping the PR's public AI framework contracts unchanged.
- Revised design to avoid HTTP/fetch and avoid a second AI-tool authorization pass; typed tools use the AI runtime policy gate and reuse API route logic in-process.
