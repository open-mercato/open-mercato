# AI Assistant Module - Agent Guidelines

> **IMPORTANT**: Update this file with every major change to this module. When implementing new features, modifying architecture, or changing key interfaces, update the relevant sections to keep guidance accurate for future agents.

## Use This Module To...

- Add AI-powered assistance capabilities to Open Mercato
- Expose module tools to an AI agent via MCP (Model Context Protocol)
- Enable dynamic API discovery so the agent can call any endpoint without hardcoded tools
- Build the Raycast-style Command Palette UI (Cmd+K) for user interaction
- Combine search-based and OpenAPI-based tool discovery

Five core components to understand:

1. **OpenCode Agent** — AI backend that processes natural language and executes tools
2. **MCP HTTP Server** — Exposes tools to OpenCode via HTTP on port 3001
3. **API Discovery Tools** — 3 meta-tools that replace 600+ individual endpoint tools
4. **Command Palette UI** — Raycast-style frontend interface
5. **Hybrid Tool Discovery** — Merges search-based and OpenAPI introspection results

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

### Modify OpenCode Configuration

1. Edit `docker/opencode/opencode.json`
2. Rebuild the container: `docker-compose build opencode`
3. Restart: `docker-compose up -d opencode`

### Add New API Endpoints to Discovery

APIs are automatically discovered from the OpenAPI spec (`openapi.yaml`). Follow these steps:

1. Define the endpoint in your module's route file with an `openApi` export
2. Regenerate the OpenAPI spec
3. Restart the MCP server

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
│  │  • Exposes 10 tools to OpenCode                                      │    │
│  │  • API discovery tools (api_discover, api_execute, api_schema)       │    │
│  │  • Search tools (search, search_status, etc.)                        │    │
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
│   │   │   ├── api-discovery-tools.ts  # api_discover, api_execute, api_schema
│   │   │   ├── api-endpoint-index.ts   # OpenAPI endpoint indexing
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

## Rules for Working with API Discovery Tools

Use 3 meta-tools instead of 600+ individual tools:

| Tool | When to use |
|------|-------------|
| `api_discover` | When you need to find APIs by keyword, module, or HTTP method |
| `api_schema` | When you need detailed schema for a specific endpoint before calling it |
| `api_execute` | When you need to execute an API call with parameters |

**Example workflow the agent follows**:
1. Agent receives: "Find all customers in New York"
2. Agent calls `api_discover("customers search")`
3. Agent calls `api_schema("/api/v1/customers")` to see parameters
4. Agent calls `api_execute({ method: "GET", path: "/api/v1/customers", query: { city: "New York" } })`

## Rules for Hybrid Tool Discovery

Tools are discovered through two combined sources:

1. **Search-based**: Semantic search over tool descriptions
2. **OpenAPI-based**: Direct introspection of API endpoints

When you need to modify discovery behavior, edit `api_discover` in `lib/api-discovery-tools.ts` — it merges both sources.

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

## Rules for API Discovery Internals

Located in `lib/api-discovery-tools.ts`. When modifying discovery logic:

```typescript
// Registered tools:
// - api_discover: Search endpoints by keyword
// - api_schema: Get endpoint details
// - api_execute: Execute API call

// Use these internal functions when extending discovery:
function searchEndpoints(query: string, options?: SearchOptions): EndpointMatch[]
function executeApiCall(params: ExecuteParams, ctx: McpToolContext): Promise<unknown>
```

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

## Future Development

Refer to git history and specs for planned features:
- AI Agent Authorization & Impersonation
- Actor + Subject model for audit trails
- Permission tiers for rate limiting
- Enhanced confirmation flow
