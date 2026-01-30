# AI Assistant Module - Agent Guide

> **IMPORTANT**: This file must be updated with every major change to this module. When implementing new features, modifying architecture, or changing key interfaces, update the relevant sections of this document to keep it accurate for future agents.

## Overview

The `ai-assistant` module provides AI-powered assistance capabilities for Open Mercato. It includes:

1. **OpenCode Agent** - AI backend that processes natural language and executes tools
2. **MCP (Model Context Protocol) Server** - Exposes tools to OpenCode via HTTP
3. **API Discovery Tools** - Meta-tools for dynamic API access (replaces 600+ individual tools)
4. **Command Palette UI** - Raycast-style interface for users to interact with AI
5. **Hybrid Tool Discovery** - Combines search-based discovery with OpenAPI introspection

## Architecture

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

## Key Concepts

### 1. OpenCode as AI Backend

OpenCode is a Go-based AI agent that runs in headless mode. It:
- Processes natural language requests
- Connects to MCP servers for tool access
- Executes multi-step workflows autonomously
- Maintains conversation sessions

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

### 2. API Discovery Tools

Instead of 600+ individual tools, we expose 3 meta-tools:

| Tool | Description |
|------|-------------|
| `api_discover` | Search for APIs by keyword, module, or HTTP method |
| `api_schema` | Get detailed schema for a specific endpoint |
| `api_execute` | Execute an API call with parameters |

**Example workflow**:
1. Agent receives: "Find all customers in New York"
2. Agent calls `api_discover("customers search")`
3. Agent calls `api_schema("/api/v1/customers")` to see parameters
4. Agent calls `api_execute({ method: "GET", path: "/api/v1/customers", query: { city: "New York" } })`

### 3. Hybrid Tool Discovery

Tools are discovered through two sources:

1. **Search-based**: Semantic search over tool descriptions
2. **OpenAPI-based**: Direct introspection of API endpoints

The `api_discover` tool combines both for comprehensive results.

### 4. Chat Flow (Frontend → OpenCode)

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

### 5. Session Management

OpenCode maintains conversation sessions for context:

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

| Route | Method | Description |
|-------|--------|-------------|
| `/api/chat` | POST | Chat with OpenCode agent (SSE stream) |
| `/api/tools` | GET | List available tools |
| `/api/tools/execute` | POST | Execute a specific tool directly |
| `/api/settings` | GET/POST | AI provider configuration |
| `/api/mcp-servers` | GET/POST | External MCP server management |

### Chat API Request/Response

**Request**:
```typescript
{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  sessionId?: string  // Optional, for continuing conversation
}
```

**SSE Events**:
```typescript
type ChatSSEEvent =
  | { type: 'thinking' }                              // Agent is processing
  | { type: 'text'; content: string }                 // Response text
  | { type: 'tool-call'; id: string; toolName: string; args: unknown }
  | { type: 'tool-result'; id: string; toolName: string; result: unknown }
  | { type: 'done'; sessionId?: string }              // Complete, with session ID
  | { type: 'error'; error: string }                  // Error occurred
```

## Frontend State Management

The command palette uses phases instead of pages:

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

## Running the Stack

### MCP Server Modes

The module provides two MCP HTTP server modes:

#### Development Server (`yarn mcp:dev`)

For local development and Claude Code integration. Authenticates once using an API key - no session tokens required.

```bash
# Reads API key from .mcp.json headers.x-api-key or OPEN_MERCATO_API_KEY env
yarn mcp:dev
```

**Key characteristics:**
- API key authentication at startup (no per-request session tokens)
- Tools filtered by API key permissions once
- Ideal for Claude Code, MCP Inspector, local testing
- Configuration via `.mcp.json`:
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

#### Production Server (`yarn mcp:serve`)

For web-based AI chat. Requires two-tier auth: server API key + user session tokens.

```bash
# Requires MCP_SERVER_API_KEY in .env
yarn mcp:serve
```

**Key characteristics:**
- Server-level auth via `x-api-key` header (validated against `MCP_SERVER_API_KEY`)
- User-level auth via `_sessionToken` parameter in each tool call
- Per-request permission checks based on user's session
- 2-hour session token TTL

#### Comparison

| Feature | Dev (`mcp:dev`) | Production (`mcp:serve`) |
|---------|-----------------|-------------------------|
| Auth | API key only | API key + session tokens |
| Permission check | Once at startup | Per tool call |
| Session tokens | Not required | Required |
| Use case | Claude Code, dev | Web AI chat |

### 1. Start MCP Server
```bash
# For development/Claude Code:
yarn mcp:dev

# For production/web chat:
yarn mcp:serve
```

### 2. Start OpenCode (Docker)
```bash
docker start opencode-mvp
# Or: docker-compose up opencode
```

### 3. Verify Connectivity
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

### 4. Start Next.js
```bash
yarn dev
```

### 5. Test
- Open browser → Press Cmd+K
- Type: "What tools do you have?"
- Should see "Agent is working..." then response

## Common Tasks

### Adding a New Tool

Register tools via `registerMcpTool()`:

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

### Modifying OpenCode Configuration

1. Edit `docker/opencode/opencode.json`
2. Rebuild: `docker-compose build opencode`
3. Restart: `docker-compose up -d opencode`

### Adding New API Endpoints to Discovery

APIs are automatically discovered from the OpenAPI spec (`openapi.yaml`). To add:

1. Define the endpoint in your module's route file
2. Regenerate the OpenAPI spec
3. Restart MCP server

### Debugging Tool Calls

1. Open Command Palette (Cmd+K)
2. Click "Debug" in footer to toggle debug panel
3. Debug panel shows all tool calls, results, errors

## Permissions (ACL)

| Feature ID | Description |
|------------|-------------|
| `ai_assistant.view` | View AI Assistant |
| `ai_assistant.settings.manage` | Manage AI settings |
| `ai_assistant.mcp.serve` | Start MCP Server |
| `ai_assistant.tools.list` | List MCP Tools |
| `ai_assistant.mcp_servers.view` | View MCP server configs |
| `ai_assistant.mcp_servers.manage` | Manage MCP server configs |

## Critical Technical Details

### OpenCode Client

Located in `lib/opencode-client.ts`:

```typescript
class OpenCodeClient {
  health(): Promise<OpenCodeHealth>
  mcpStatus(): Promise<OpenCodeMcpStatus>
  createSession(): Promise<OpenCodeSession>
  getSession(id: string): Promise<OpenCodeSession>
  sendMessage(sessionId: string, message: string): Promise<OpenCodeMessage>
}

// Factory function with env defaults
function createOpenCodeClient(config?: Partial<OpenCodeClientConfig>): OpenCodeClient
```

### OpenCode Handlers

Located in `lib/opencode-handlers.ts`:

```typescript
// Main handler for chat API
async function handleOpenCodeMessage(options: {
  message: string
  sessionId?: string
}): Promise<OpenCodeTestResponse>

// Extract text from OpenCode response parts
function extractTextFromResponse(result: OpenCodeMessage): string
```

### API Discovery Tools

Located in `lib/api-discovery-tools.ts`:

```typescript
// Registered tools:
// - api_discover: Search endpoints by keyword
// - api_schema: Get endpoint details
// - api_execute: Execute API call

// Internal functions:
function searchEndpoints(query: string, options?: SearchOptions): EndpointMatch[]
function executeApiCall(params: ExecuteParams, ctx: McpToolContext): Promise<unknown>
```

### API Endpoint Index

Located in `lib/api-endpoint-index.ts`:

```typescript
class ApiEndpointIndex {
  static getInstance(): ApiEndpointIndex
  searchEndpoints(query: string, options?: SearchOptions): EndpointMatch[]
  getEndpoint(operationId: string): EndpointInfo | null
  getEndpointByPath(method: string, path: string): EndpointInfo | null
}
```

## Docker Configuration

### OpenCode Container

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

## Debug Features

### Debug Panel

Toggle with "Debug" button in Command Palette footer. Shows:
- `thinking` - Agent processing started
- `tool-call` - Tool invocation with args
- `tool-result` - Tool response
- `text` - Response text chunks
- `error` - Errors
- `done` - Completion

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

## Changelog

### 2026-01-17 - Session Persistence Fix

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

## Session Management Deep Dive

### Architecture Overview

The session flow spans multiple layers:

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

### Session ID Flow

1. **First message**: No sessionId → `startAgenticChat()` creates new session
2. **OpenCode responds**: SSE stream emits `{ type: 'done', sessionId: 'ses_xxx' }`
3. **Frontend stores**: `opencodeSessionIdRef.current = sessionId`
4. **Subsequent messages**: `sendAgenticMessage()` includes sessionId in request body
5. **Backend receives**: Uses existing session instead of creating new one

### Critical: React Refs vs State for Session ID

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

**Solution**: Use both state (for React reactivity) AND ref (for callbacks):

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

### SSE Stream Completion Bug (Fixed 2026-01)

**Problem**: `done` event with sessionId was never emitted to frontend.

**Root Cause**: In `opencode-handlers.ts`, the code used `Promise.race()`:

```typescript
// BUG: sendPromise resolves before SSE emits session.status: idle
await Promise.race([eventPromise, sendPromise.catch(err => Promise.reject(err))])
```

When `sendMessage()` HTTP call completed, `Promise.race` resolved immediately, BEFORE the SSE handler could receive the `session.status: idle` event and emit `done`.

**Fix**: Only wait for SSE completion, catch send errors separately:

```typescript
// FIXED: SSE determines completion, not HTTP response
client.sendMessage(session.id, message, { model }).catch((err) => {
  console.error('[OpenCode] Send error (SSE should handle):', err)
})
await eventPromise  // Only SSE determines completion
```

### OpenCode SSE Event Flow

OpenCode emits events via Server-Sent Events. The completion flow:

1. `session.status: busy` - Processing started
2. `message.part.updated` - Text chunks, tool calls, tool results
3. `message.updated` - Message completed (with tokens, timing)
4. `session.status: idle` - Processing complete → emit `done` event

**Key insight**: The `session.status: idle` event triggers `done`, not HTTP completion.

### Debugging Session Issues

Add diagnostic logging to trace session flow:

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

**What to check**:
1. First message: `refValue: null, willContinue: false` ✓
2. After first response: Look for `Done event` with sessionId
3. Second message: `refValue: 'ses_xxx', willContinue: true` ✓
4. Backend: `hasSessionId: true` ✓

### Common Session Problems

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Second message loses context | sessionId not stored | Check `done` event has sessionId |
| `refValue: null` on second message | Stale closure | Use ref pattern (see above) |
| Backend `hasSessionId: false` | Request serialization issue | Check JSON.stringify includes sessionId |
| `done` event never emitted | Promise.race bug | See SSE completion fix above |
| Multiple `session-authorized` events | Creating new session each time | sessionId not passed to backend |

### Testing Session Persistence

1. Open browser console (F12)
2. Open AI Assistant (Cmd+K)
3. Send: "find customer Taylor"
4. Check console for `Done event` with sessionId
5. Send: "find his related companies"
6. Check: `willContinue: true` and AI knows about Taylor

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Agent is working..." forever | OpenCode not responding | Check `curl http://localhost:4096/global/health` |
| "MCP connection failed" | MCP server not running | Start with `yarn mercato ai_assistant mcp:serve-http --port 3001` |
| Empty response | OpenCode not connected to MCP | Check `curl http://localhost:4096/mcp` |
| "Unauthorized" error | Missing/invalid API key | Check x-api-key in opencode.json |
| Tools not found | Endpoint not in OpenAPI | Regenerate OpenAPI spec |
| Context lost between messages | Session ID not persisted | See "Session Management Deep Dive" above |
| "Session expired" errors | Session token TTL exceeded | Close and reopen chat (creates new 2-hour token) |
| Tools fail with UNAUTHORIZED | Missing _sessionToken | Verify AI is passing token in tool args |

---

## Two-Tier Authentication Architecture

The MCP HTTP server implements two distinct authentication layers:

### Tier 1: Server-Level Authentication

**Purpose**: Validates that requests come from an authorized AI agent (e.g., OpenCode)

```
Request → Check x-api-key header → Compare with MCP_SERVER_API_KEY env var
```

| Aspect | Details |
|--------|---------|
| **Header** | `x-api-key` |
| **Value** | Static API key from `MCP_SERVER_API_KEY` environment variable |
| **Configured In** | `opencode.json` or `opencode.jsonc` |
| **Validation** | Direct string comparison |
| **Result** | Grants access to call MCP endpoints (but no user permissions) |

**Code reference**: `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts:370-391`

### Tier 2: User-Level Authentication (Session Tokens)

**Purpose**: Identifies the actual user and loads their permissions for each tool call

```
Tool call → Extract _sessionToken → Lookup in DB → Load ACL → Check permissions
```

| Aspect | Details |
|--------|---------|
| **Parameter** | `_sessionToken` in tool call args |
| **Format** | `sess_{32 hex chars}` (e.g., `sess_a1b2c3d4e5f6...`) |
| **TTL** | 120 minutes (2 hours) |
| **Storage** | `api_keys` table |
| **Lookup** | `findApiKeyBySessionToken()` |
| **ACL** | `rbacService.loadAcl()` |

**Code references**:
- Session creation: `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts:133-157`
- Token lookup: `packages/core/src/modules/api_keys/services/apiKeyService.ts:143-158`
- Context resolution: `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts:32-88`

---

## Session Token System

### Token Generation

```typescript
// packages/core/src/modules/api_keys/services/apiKeyService.ts:99-101
export function generateSessionToken(): string {
  return `sess_${randomBytes(16).toString('hex')}`
}
// Result: "sess_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
```

### Token Storage (api_keys table)

Session tokens create ephemeral API keys with additional columns:

| Column | Type | Description |
|--------|------|-------------|
| `sessionToken` | string | The `sess_xxx` token for lookup |
| `sessionUserId` | string | ID of the user this session represents |
| `rolesJson` | string[] | User's role IDs (inherited from user) |
| `tenantId` | string | Tenant scope |
| `organizationId` | string | Organization scope |
| `expiresAt` | Date | TTL (default: 120 minutes from creation) |

### Token Injection Into Messages

When a new chat session starts, the backend injects a system instruction:

```typescript
// packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts:161-164
let messageToSend = lastUserMessage
if (sessionToken) {
  messageToSend = `[SYSTEM: Your session token is "${sessionToken}". You MUST include "_sessionToken": "${sessionToken}" in EVERY tool call argument object. Without this, tools will fail with authorization errors.]\n\n${lastUserMessage}`
}
```

This ensures the AI agent (Claude via OpenCode) includes the token in all tool calls.

### Token in Tool Calls

The MCP server schema transformation injects `_sessionToken` into every tool:

```typescript
// packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts:128-131
properties._sessionToken = {
  type: 'string',
  description: 'Session authorization token (REQUIRED for all tool calls)',
}
```

AI sees this parameter and includes it:

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

## Session Context Resolution

When a tool call arrives with `_sessionToken`:

### Step 1: Extract Token

```typescript
// http-server.ts:169-170
const sessionToken = toolArgs._sessionToken as string | undefined
delete toolArgs._sessionToken // Remove before passing to handler
```

### Step 2: Lookup Session Key

```typescript
// http-server.ts:42 → apiKeyService.ts:143-158
const sessionKey = await findApiKeyBySessionToken(em, sessionToken)
// Returns null if: not found, deleted, or expired
```

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

---

## Updated SSE Events

### Full Event Types

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

### Additional Events from Chat API

| Event | Emitted By | Purpose |
|-------|------------|---------|
| `session-authorized` | `chat/route.ts:170-175` | Confirms session token created for new chat |

### Debug Events (partType values)

| partType | Description |
|----------|-------------|
| `question-asked` | OpenCode asking a confirmation question |
| `message-completed` | Assistant message with token counts |
| `step-start` | Agentic step beginning |
| `step-finish` | Agentic step complete |

---

## MCP HTTP Server Details

### Stateless Request Model

Each HTTP request creates a fresh MCP server instance:

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

**Benefits**:
- No session state to manage
- Clean isolation between requests
- Scales horizontally

### Schema Transformation

Tool schemas are transformed to include `_sessionToken`:

1. **Convert** Zod schema → JSON Schema (`z.toJSONSchema()`)
2. **Inject** `_sessionToken` property into `properties`
3. **Convert** JSON Schema → Zod with `.passthrough()`
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

### Per-Tool ACL Checks

Each tool call validates permissions using the session's ACL:

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

### Error Responses

| Code | Message | Cause |
|------|---------|-------|
| `SESSION_EXPIRED` | "Your chat session has expired..." | Token TTL exceeded (>2 hours) |
| `UNAUTHORIZED` | "Session token required" | No `_sessionToken` in args |
| `UNAUTHORIZED` | "Insufficient permissions" | User lacks required features |

---

## Future Development

See the original AGENTS.md for planned features:
- AI Agent Authorization & Impersonation
- Actor + Subject model for audit trails
- Permission tiers for rate limiting
- Enhanced confirmation flow
