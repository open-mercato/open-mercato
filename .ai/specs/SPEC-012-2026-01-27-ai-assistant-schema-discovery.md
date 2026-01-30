# SPEC-012: AI Assistant Schema & API Discovery

## Overview

The AI Assistant module provides MCP (Model Context Protocol) tools that enable AI to discover and interact with the system's database entities and API endpoints. This specification documents the current implementation of entity schema discovery and OpenAPI integration.

## Problem Statement

AI assistants need to understand the data model and available APIs to effectively help users query and manipulate data. This requires:

1. Discovering database entity schemas (fields, types, relationships)
2. Finding relevant API endpoints for CRUD operations
3. Executing API calls with proper authentication and context

## Architecture

The system uses two parallel discovery mechanisms:

```
┌─────────────────────────────────────────────────────────────────┐
│                         AT STARTUP                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MikroORM ──► extractEntityGraph() ──► EntityGraph (cached)    │
│                                              │                  │
│                                              ▼                  │
│                                    indexEntitiesForSearch()     │
│                                              │                  │
│                                              ▼                  │
│                                    Meilisearch (ai_assistant:   │
│                                                entity_schema)   │
│                                                                 │
│  openapi.generated.json ──► parseApiEndpoints() ──► ApiEndpoint[]│
│  (or module registry)                               (cached)    │
│                                              │                  │
│                                              ▼                  │
│                                    indexApiEndpoints()          │
│                                              │                  │
│                                              ▼                  │
│                                    Meilisearch (ai_assistant:   │
│                                                api_endpoint)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         AT RUNTIME                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AI calls discover_schema("Customer")                           │
│       │                                                         │
│       ▼                                                         │
│  Search Meilisearch (or fallback to in-memory)                  │
│       │                                                         │
│       ▼                                                         │
│  Return: entity fields + relationships                          │
│                                                                 │
│  AI calls find_api("list customers")                            │
│       │                                                         │
│       ▼                                                         │
│  Search Meilisearch (or fallback to in-memory)                  │
│       │                                                         │
│       ▼                                                         │
│  Return: endpoint path + method + schema                        │
│                                                                 │
│  AI calls call_api({ method, path, body })                      │
│       │                                                         │
│       ▼                                                         │
│  Execute HTTP request with tenant context + auth                │
│       │                                                         │
│       ▼                                                         │
│  Return: API response data                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Entity Graph

Extracted from MikroORM metadata at startup:

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

### API Endpoint

Parsed from OpenAPI specification:

```typescript
interface ApiEndpoint {
  id: string              // operationId
  operationId: string     // "customers_put_people"
  method: string          // "PUT"
  path: string            // "/api/customers/people"
  summary: string
  description: string
  tags: string[]          // ["Customers"]
  requiredFeatures: string[]  // from x-require-features extension
  parameters: ApiParameter[]   // path + query params only
  requestBodySchema: Record<string, unknown> | null
  deprecated: boolean
}

interface ApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: string
  description: string
}
```

### MCP Tool Context

```typescript
interface McpToolContext {
  tenantId?: string
  organizationId?: string
  userId?: string
  apiKeySecret?: string
  container: AwilixContainer  // DI container for services
}
```

## MCP Tools

### `discover_schema` - Entity Discovery

**Purpose:** Search for database entity schemas by name or keyword

**Input:**
```typescript
{
  query: string    // Entity name or keyword (e.g., "Company", "sales order")
  limit?: number   // Maximum results (default: 5)
}
```

**Search strategy:**
1. Try Meilisearch hybrid search (fulltext + vector) on indexed entity schemas
2. Fallback: In-memory fuzzy search on className, tableName, inferred module

**Output:**
```json
{
  "success": true,
  "count": 1,
  "entities": [{
    "className": "CustomerCompanyProfile",
    "tableName": "customer_company_profiles",
    "module": "customers",
    "fields": [
      { "name": "id", "type": "uuid", "nullable": false },
      { "name": "name", "type": "string", "nullable": false }
    ],
    "relationships": [
      { "relationship": "BELONGS_TO", "target": "CustomerEntity", "property": "customer", "nullable": false }
    ]
  }]
}
```

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/entity-graph-tools.ts`

### `find_api` - API Discovery

**Purpose:** Search for API endpoints by natural language query

**Input:**
```typescript
{
  query: string                     // Natural language query
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'  // Optional filter
  limit?: number                    // Max results (default: 10)
}
```

**Search strategy:**
1. Try Meilisearch hybrid search on indexed endpoints
2. Fallback: In-memory text matching on operationId, path, summary, description, tags

**Output:**
```json
{
  "success": true,
  "message": "Found 2 matching endpoint(s)",
  "endpoints": [{
    "operationId": "customers_put_companies",
    "method": "PUT",
    "path": "/api/customers/companies",
    "description": "Updates company details...",
    "tags": ["Customers"],
    "parameters": [
      { "name": "id", "in": "query", "required": true, "type": "string" }
    ],
    "requestBody": {
      "required": ["id"],
      "properties": {
        "name": { "type": "string" },
        "email": { "type": "string", "format": "email" }
      }
    }
  }],
  "hint": "Use call_api with the method, path, and body structure shown above."
}
```

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/api-discovery-tools.ts`

### `call_api` - API Execution

**Purpose:** Execute an API endpoint

**Input:**
```typescript
{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string                          // e.g., "/api/customers/companies"
  query?: Record<string, string>        // Query parameters
  body?: Record<string, unknown>        // Request body
}
```

**Execution:**
1. Build URL from env vars (NEXT_PUBLIC_APP_URL, APP_URL, etc.)
2. Add tenant/org context to query (GET) or body (mutations)
3. Add auth headers (X-API-Key, X-Tenant-Id, X-Organization-Id)
4. Execute fetch, return parsed JSON response

**Output:**
```json
{
  "success": true,
  "statusCode": 200,
  "data": { /* API response */ }
}
```

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/api-discovery-tools.ts`

### `context_whoami` - Authentication Context

**Purpose:** Get current authentication context

**Output:**
```json
{
  "tenantId": "uuid",
  "organizationId": "uuid",
  "userId": "uuid"
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

**When it runs:** At MCP server startup (`mcp-dev-server.ts` lines 254-266)

### Module Inference

**File:** `entity-graph.ts` → `inferModuleFromEntity(className, tableName)`

**Strategy (in order):**
1. Table name prefix: `sales_orders` → `sales`
2. Class name prefix: `SalesOrder` → `sales` (via moduleMap)
3. Default: `core`

**Module mapping:**
```typescript
{
  sales: 'sales',
  customer: 'customers',
  catalog: 'catalog',
  product: 'catalog',
  order: 'sales',
  auth: 'auth',
  user: 'auth',
  workflow: 'workflows',
  config: 'configs',
  dictionary: 'dictionaries',
  // ... etc
}
```

## OpenAPI Collection Process

### How Specs Are Collected

**Source:** `openApi` exports from API route files

**Example route file:** `packages/core/src/modules/customers/api/people/route.ts`
```typescript
export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Person',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(personListItemSchema),
  create: { schema: personCreateSchema, responseSchema: personCreateResponseSchema },
  update: { schema: personUpdateSchema, responseSchema: defaultOkResponseSchema },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema },
})
```

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
Output: apps/mercato/.mercato/generated/modules.generated.ts
        apps/mercato/.mercato/generated/openapi.generated.json
```

### How Endpoints Are Parsed

**File:** `packages/ai-assistant/src/modules/ai_assistant/lib/api-endpoint-index.ts`

**Parse order (first success wins):**
1. Generated JSON: `openapi.generated.json` (CLI context)
2. Module registry: `getModules()` → `buildOpenApiDocument()` (Next.js context)
3. HTTP fetch: `GET /api/docs/openapi` (requires running app)

### OpenAPI Document Generation

**File:** `packages/shared/src/lib/openapi/generator.ts`

**Function:** `buildOpenApiDocument(modules, options)`

```
For each module in modules:
  For each api in module.apis:
    If api.docs exists (the openApi export):
      - Convert Zod schemas → JSON Schema via zodToJsonSchema()
      - Generate example values via generateExample()
      - Build cURL code samples
      - Merge method documentation
        ↓
Combine all into OpenAPI 3.1.0 paths object
```

## Search Indexing

### What Gets Indexed

**Entity schemas** (`entity-index-config.ts`):
- Entity ID: `ai_assistant:entity_schema`
- Indexed: className, tableName, module
- Full schema stored as JSON (excluded from fulltext)
- Checksum-based change detection

**API endpoints** (`api-endpoint-index-config.ts`):
- Entity ID: `ai_assistant:api_endpoint`
- Indexed: method, path, operationId, summary, description, tags
- Action words added per HTTP method for semantic matching
- Checksum-based change detection

**Search strategies:** fulltext + vector (hybrid)

## Authentication & Context

### MCP Server Modes

| Mode | Auth | Use Case |
|------|------|----------|
| Dev (`yarn mcp:dev`) | API key at startup | Claude Code, local dev |
| Production (`yarn mcp:serve`) | API key + session tokens | Web AI chat |

### Session Management

- Sessions use ephemeral API keys inheriting user permissions
- Session tokens expire after 2 hours of inactivity
- Expired sessions return `SESSION_EXPIRED` error

## Key Files Reference

| File | Purpose |
|------|---------|
| `entity-graph.ts` | Extracts entity metadata from MikroORM |
| `entity-graph-tools.ts` | `discover_schema` MCP tool |
| `entity-index-config.ts` | Search index config for entities |
| `api-endpoint-index.ts` | Parses OpenAPI, caches endpoints |
| `api-discovery-tools.ts` | `find_api` and `call_api` MCP tools |
| `api-endpoint-index-config.ts` | Search index config for endpoints |
| `tool-loader.ts` | Loads and registers all MCP tools |
| `mcp-server.ts` | MCP server creation and request handling |
| `mcp-dev-server.ts` | Development MCP server with API key auth |

All files in: `packages/ai-assistant/src/modules/ai_assistant/lib/`

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

### 2026-01-27
- Initial specification documenting current implementation
