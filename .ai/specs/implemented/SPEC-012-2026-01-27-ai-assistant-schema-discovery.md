# SPEC-012: AI Assistant Schema & API Discovery

## TLDR

- The MCP server exposes **2 Code Mode tools** (`search` + `execute`) plus `context_whoami` — total 3 tools
- Replaces the previous 4 built-in tools (`find_api`, `call_api`, `discover_schema`, `context_whoami`) and all module-specific AI tools (6 from search)
- The AI writes JavaScript that runs in a `node:vm` sandbox with injected globals (`spec`, `api.request()`, `context`)
- Token savings: from ~10 tool schemas to exactly 2, with a fixed footprint regardless of API surface growth
- Inspired by [Cloudflare's Code Mode pattern](https://blog.cloudflare.com/mcp-code-mode/)

## Overview

The AI Assistant module provides MCP (Model Context Protocol) tools that enable AI to discover and interact with the system's database entities and API endpoints. Instead of exposing individual tools per operation, the server provides two programmable meta-tools where the AI writes JavaScript code to query the full OpenAPI spec and make authenticated API calls.

## Problem Statement

AI assistants need to understand the data model and available APIs to effectively help users query and manipulate data. The original approach exposed individual tools (`find_api`, `call_api`, `discover_schema`) plus module-specific tools — each with its own schema consuming context tokens. As the API surface grew (358 endpoints, 124 entities), the tool schema overhead grew proportionally.

**Key problems solved:**
1. Tool schema token overhead scales with API surface (O(n) → O(1))
2. Multi-step discovery required 3 separate tool calls (discover → find → call)
3. Module-specific tools duplicated patterns already available via the API

## Architecture

### Startup Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│                         AT STARTUP                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MikroORM ──► extractEntityGraph() ──► EntityGraph (cached)    │
│                                                                 │
│  openapi.generated.json ──► getRawOpenApiSpec() ──► OpenApiDoc │
│  (or module registry)                               (cached)    │
│                                                                 │
│  EntityGraph + OpenApiDoc ──► getCodeModeSpec() ──► merged spec│
│                                                      (cached)   │
│    spec.paths          = OpenAPI paths object                   │
│    spec.entitySchemas  = [{ className, tableName, module,      │
│                             fields, relationships }]            │
│    spec.components     = OpenAPI components                     │
│                                                                 │
│  Tool registry: context_whoami + search + execute = 3 tools    │
│                                                                 │
│  (Search indexing still runs for Meilisearch if available)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Runtime Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         AT RUNTIME                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AI calls search({ code: "async () => ..." })                  │
│       │                                                         │
│       ▼                                                         │
│  normalizeCode() — strip markdown fences, validate shape        │
│       │                                                         │
│       ▼                                                         │
│  createSandbox({ spec }) — node:vm with whitelisted globals    │
│       │                                                         │
│       ▼                                                         │
│  Execute in sandbox — AI code queries spec.paths,              │
│                       spec.entitySchemas, spec.components       │
│       │                                                         │
│       ▼                                                         │
│  truncateResult() — cap at 40K chars (~10K tokens)             │
│       │                                                         │
│       ▼                                                         │
│  Return: { success, result, logs, durationMs }                 │
│                                                                 │
│                                                                 │
│  AI calls execute({ code: "async () => ..." })                 │
│       │                                                         │
│       ▼                                                         │
│  createSandbox({ api: { request }, context })                  │
│       │                                                         │
│       ▼                                                         │
│  AI code calls api.request({ method, path, query?, body? })    │
│       │                                                         │
│       ▼                                                         │
│  api.request() closure (runs in HOST, not sandbox):            │
│    - Build URL from env vars                                    │
│    - Inject tenantId/organizationId into query or body          │
│    - Set X-API-Key, X-Tenant-Id, X-Organization-Id headers     │
│    - Call globalThis.fetch() (not sandbox fetch)                │
│    - Track call count (max 50)                                  │
│       │                                                         │
│       ▼                                                         │
│  Return: { success, result, logs, durationMs, apiCallCount }   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Example AI Workflow

```
User: "Find all customers in New York"

1. AI calls search:
   async () => Object.keys(spec.paths).filter(p => p.includes('customer'))
   → ["/api/customers/companies", "/api/customers/people", ...]

2. AI calls search:
   async () => spec.paths["/api/customers/companies"]?.get
   → { operationId, parameters, ... }

3. AI calls execute:
   async () => api.request({
     method: 'GET',
     path: '/api/customers/companies',
     query: { city: 'New York' }
   })
   → { success: true, statusCode: 200, data: { items: [...], total: 5 } }
```

## Sandbox Security Model

The `node:vm` sandbox restricts what code can access:

### Allowed Globals

| Category | Globals |
|----------|---------|
| Data types | `JSON`, `Object`, `Array`, `Map`, `Set`, `Promise`, `Math`, `Date`, `RegExp`, `String`, `Number`, `Boolean` |
| Parsing | `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURIComponent`, `decodeURIComponent` |
| Errors | `Error`, `TypeError`, `RangeError` |
| Constants | `undefined`, `NaN`, `Infinity` |
| Injected | `console` (captured to logs array), caller-provided globals (`spec`, `api`, `context`) |

### Blocked Globals

All set to `undefined`: `require`, `import`, `process`, `global`, `globalThis`, `fetch`, `XMLHttpRequest`, `WebSocket`, `Buffer`, `setTimeout`, `setInterval`, `__dirname`, `__filename`

### Safety Limits

| Limit | Default | Purpose |
|-------|---------|---------|
| Execution timeout | 30 seconds | Prevents infinite loops (vm.Script timeout + Promise.race) |
| Max API calls | 50 per execution | Prevents runaway API flooding |
| Max output size | 40,000 chars | ~10K tokens, prevents context window overflow |
| Max log entries | 100 | Caps console.log capture |
| Max log entry length | 1,000 chars | Prevents log flooding |

### Code Validation

`normalizeCode()` enforces:
1. Strip markdown code fences (` ```javascript `, ` ```js `, ` ``` `)
2. Must match pattern `async (` — rejects arbitrary code
3. Wrapped as `(async () => { return (CODE)() })()` for execution

## Data Models

### Entity Graph

Extracted from MikroORM metadata at startup (unchanged from original):

```typescript
interface EntityGraph {
  nodes: EntityNode[]      // All entities
  edges: EntityTriple[]    // All relationships
  generatedAt: string
}

interface EntityNode {
  className: string        // "CustomerEntity"
  tableName: string        // "customers"
  properties: Array<{
    name: string           // "email"
    type: string           // "string"
    nullable: boolean
  }>
}

interface EntityTriple {
  source: string           // "CustomerEntity"
  relationship: RelationshipType  // "HAS_MANY"
  target: string           // "CustomerDeal"
  property: string         // "deals"
  nullable?: boolean
}

type RelationshipType =
  | 'BELONGS_TO'       // ManyToOne
  | 'HAS_MANY'         // OneToMany
  | 'HAS_ONE'          // OneToOne (owner)
  | 'BELONGS_TO_ONE'   // OneToOne (inverse)
  | 'HAS_MANY_MANY'    // ManyToMany (owner)
  | 'BELONGS_TO_MANY'  // ManyToMany (inverse)
```

### Code Mode Spec (Merged Object)

The `spec` global injected into the `search` sandbox combines OpenAPI + entity graph:

```typescript
{
  paths: Record<string, OpenApiPathItem>  // From getRawOpenApiSpec()
  components: OpenApiComponents           // From getRawOpenApiSpec()
  info: OpenApiInfo                       // From getRawOpenApiSpec()
  entitySchemas: Array<{                  // From getCachedEntityGraph()
    className: string                     // "SalesOrder"
    tableName: string                     // "sales_orders"
    module: string                        // "sales"
    fields: Array<{ name, type, nullable }>
    relationships: Array<{ relationship, target, property, nullable }>
  }>
}
```

### Sandbox Types

```typescript
interface SandboxOptions {
  timeout?: number        // ms, default 30_000
  maxOutputSize?: number  // bytes, default 1_048_576
  maxApiCalls?: number    // default 50
}

interface SandboxResult {
  result: unknown
  error?: string
  logs: string[]          // Captured console output
  durationMs: number
  apiCallCount?: number   // Only for execute tool
}
```

### MCP Tool Context

```typescript
interface McpToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  apiKeySecret?: string
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
}
```

## MCP Tools

### `search` — Spec Discovery

**Purpose:** Run JavaScript to query the OpenAPI spec and entity schemas programmatically.

**Input:**
```typescript
{ code: string }  // An async arrow function, e.g. "async () => spec.paths['/api/customers/companies']"
```

**Sandbox globals:** `spec` (merged OpenAPI + entity schemas)

**Output:**
```json
{
  "success": true,
  "result": "[ ... serialized JSON ... ]",
  "logs": ["optional console.log output"],
  "durationMs": 1
}
```

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/codemode-tools.ts`

### `execute` — API Execution

**Purpose:** Run JavaScript that makes authenticated API calls via `api.request()`.

**Input:**
```typescript
{ code: string }  // An async arrow function using api.request()
```

**Sandbox globals:**
- `api.request({ method, path, query?, body? })` — authenticated HTTP call (runs in host, not sandbox)
- `context` — `{ tenantId, organizationId, userId }`

**api.request() behavior:**
1. Build URL: `baseUrl` from env vars + path (ensures `/api` prefix)
2. For GET: inject `tenantId`/`organizationId` into query params
3. For POST/PUT/PATCH: inject `tenantId`/`organizationId` into body
4. Set headers: `Content-Type`, `X-API-Key`, `X-Tenant-Id`, `X-Organization-Id`
5. Call `globalThis.fetch()` (host fetch, not sandbox)
6. Return `{ success, statusCode, data }` or `{ success: false, statusCode, error, details }`

**Output:**
```json
{
  "success": true,
  "result": "{ \"success\": true, \"statusCode\": 200, \"data\": { ... } }",
  "logs": [],
  "durationMs": 312,
  "apiCallCount": 1
}
```

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/codemode-tools.ts`

### `context_whoami` — Authentication Context

**Purpose:** Get current authentication context (unchanged).

**Output:**
```json
{
  "tenantId": "uuid",
  "organizationId": "uuid",
  "userId": "uuid",
  "isSuperAdmin": true,
  "features": ["customers.*", "sales.*", "..."],
  "featureCount": 42
}
```

## Entity Extraction Process

### How Schemas Are Extracted

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/entity-graph.ts`

```
MikroORM.getMetadata().getAll()
    ↓
For each entity:
  - Skip if abstract or embeddable
  - Skip if className starts with "MikroORM"
  - Extract className (e.g., "SalesOrder")
  - Extract tableName (e.g., "sales_orders")
  - For each property:
    - Skip if name starts with "_"
    - If ReferenceKind.SCALAR → add to fields[]
    - If relationship → add to edges[] with type mapping:
        MANY_TO_ONE    → BELONGS_TO
        ONE_TO_MANY    → HAS_MANY
        ONE_TO_ONE     → HAS_ONE / BELONGS_TO_ONE (based on mappedBy)
        MANY_TO_MANY   → HAS_MANY_MANY / BELONGS_TO_MANY (based on mappedBy)
    ↓
Cache in memory as EntityGraph { nodes[], edges[], generatedAt }
```

**When it runs:** At MCP server startup in all 3 server modes (dev, production, stdio).

### Module Inference

**File:** `entity-graph.ts` → `inferModuleFromEntity(className, tableName)`

**Strategy (in order):**
1. Table name prefix: `sales_orders` → `sales`
2. Class name prefix: `SalesOrder` → `sales` (via moduleMap)
3. Default: `core`

## OpenAPI Collection Process

### How Specs Are Collected

**Source:** `openApi` exports from API route files

**Generator process:** (`packages/cli/src/lib/generators/module-registry.ts`)
```
npm run modules:prepare
    ↓
Scan all src/modules/<module>/api/**/*.ts
    ↓
For each route file:
  - Check if exports `openApi` via moduleHasExport()
  - If yes, include in generated module entry
    ↓
Output: apps/mercato/.mercato/generated/openapi.generated.json
```

### How the Raw Spec Is Loaded

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/api-endpoint-index.ts`

**Function:** `getRawOpenApiSpec()` — returns the full `OpenApiDocument` object (not parsed endpoints).

**Loading order (first success wins):**
1. Generated JSON: `openapi.generated.json` (CLI context)
2. Module registry: `getModules()` → `buildOpenApiDocument()` (Next.js context)
3. HTTP fetch: `GET /api/docs/openapi` (requires running app)

The raw spec is cached in memory and merged with the entity graph by `getCodeModeSpec()` to produce the `spec` global for the `search` tool.

## Search Indexing

Search indexing still runs at startup for Meilisearch (used by other features). The Code Mode tools do not depend on it — they use the cached in-memory spec directly.

**Entity schemas** (`entity-index-config.ts`):
- Entity ID: `ai_assistant:entity_schema`
- Indexed: className, tableName, module

**API endpoints** (`api-endpoint-index-config.ts`):
- Entity ID: `ai_assistant:api_endpoint`
- Indexed: method, path, operationId, summary, description, tags

## Authentication & Context

### MCP Server Modes

| Mode | Auth | Use Case |
|------|------|----------|
| Dev (`yarn mcp:dev`) | API key at startup | Claude Code, local dev |
| Production (`yarn mcp:serve`) | API key + session tokens | Web AI chat |
| Stdio (`yarn mcp:serve --stdio`) | API key or manual context | Direct CLI usage |

### Session Management

- Sessions use ephemeral API keys inheriting user permissions
- Session tokens expire after 2 hours of inactivity
- Expired sessions return `SESSION_EXPIRED` error

## Key Files Reference

| File | Purpose |
|------|---------|
| `codemode-tools.ts` | `search` and `execute` tool definitions, spec merging |
| `sandbox.ts` | `node:vm` sandbox executor, `normalizeCode()` |
| `truncate.ts` | Response size limiter (`truncateResult()`) |
| `api-endpoint-index.ts` | OpenAPI parsing, `getRawOpenApiSpec()` |
| `entity-graph.ts` | Extracts entity metadata from MikroORM |
| `tool-loader.ts` | Loads and registers all MCP tools |
| `tool-registry.ts` | Global tool registration singleton |
| `mcp-server.ts` | Stdio MCP server |
| `mcp-dev-server.ts` | Development MCP server with API key auth |
| `http-server.ts` | Production MCP HTTP server |

**Legacy files (kept, unused):**

| File | Original Purpose |
|------|-----------------|
| `api-discovery-tools.ts` | Old `find_api` / `call_api` tools |
| `entity-graph-tools.ts` | Old `discover_schema` tool |

All files in: `packages/ai-assistant/src/modules/ai_assistant/lib/`

## Verified Test Results (2026-02-22)

Tested against live MCP dev server with 358 API endpoints and 124 entities:

| Test | Result |
|------|--------|
| `search` — filter paths by keyword | 21 customer paths, 4ms |
| `search` — filter entities by module | 25 sales entities, 1ms |
| `search` — get endpoint spec details | Full GET/POST/PUT/DELETE spec, 1ms |
| `search` — entity fields + relationships | SalesOrder: 58 fields, 13 relations, 1ms |
| `execute` — GET API call | 200 with paginated response, 312ms |
| `execute` — multi-step + console.log | Logs captured, context correct, 349ms |
| `execute` — POST create + GET verify | Created company, total=1, 835ms |
| `execute` — POST validation error | 400 with field-level details, 267ms |
| Markdown code fence stripping | 182 paths returned correctly |
| Security: `fetch()` blocked | `fetch is not a function` |
| Security: `process.env` blocked | `Cannot read properties of undefined` |
| Security: `require()` blocked | `require is not a function` |
| Security: invalid code format | Clear error message |
| Security: infinite loop timeout | Timed out after 30s |

## Runtime Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/docs/openapi` | Returns full OpenAPI JSON document |
| `GET /api/docs/markdown` | Returns API docs as Markdown |

## CLI Commands

```bash
# Run development MCP server
yarn mcp:dev

# Run production MCP server
yarn mcp:serve

# List available MCP tools
yarn mercato ai_assistant mcp:list-tools

# List tools with descriptions
yarn mercato ai_assistant mcp:list-tools --verbose
```

## Changelog

### 2026-02-22
- Replaced `find_api`, `call_api`, `discover_schema` and module AI tools with Code Mode `search` + `execute`
- Added `node:vm` sandbox with security restrictions
- Added response truncation (40K chars)
- Added raw OpenAPI spec caching (`getRawOpenApiSpec()`)
- Updated architecture diagrams and tool documentation
- Added verified test results

### 2026-01-27
- Initial specification documenting the original implementation (discover_schema, find_api, call_api, context_whoami)
