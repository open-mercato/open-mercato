# AI Assistant Module - Agent Guide

> **IMPORTANT**: This file must be updated with every major change to this module. When implementing new features, modifying architecture, or changing key interfaces, update the relevant sections of this document to keep it accurate for future agents.

## Overview

The `ai-assistant` module provides AI-powered assistance capabilities for Open Mercato. It includes:

1. **MCP (Model Context Protocol) Server** - Exposes tools from all modules to AI clients
2. **MCP Client** - Connects to MCP servers (local and external) for tool discovery and execution
3. **Command Palette UI** - Raycast-style interface for users to interact with AI and tools
4. **Chat API** - Streaming chat with AI providers (OpenAI, Anthropic, Google)
5. **Settings Management** - Configuration for AI providers and MCP servers

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AI ASSISTANT MODULE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │   MCP Server     │    │   MCP Client     │    │  Chat Provider   │  │
│  │  (Tool Host)     │◄───│  (Tool Consumer) │    │  (AI Models)     │  │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘  │
│           │                       │                       │            │
│           ▼                       ▼                       ▼            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        API Routes (/api/ai/*)                     │  │
│  │  • /chat - Streaming chat with AI                                 │  │
│  │  • /tools - List available tools                                  │  │
│  │  • /tools/execute - Execute a tool                                │  │
│  │  • /settings - AI provider configuration                          │  │
│  │  • /mcp-servers - External MCP server management                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                  │                                     │
│                                  ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Frontend (Command Palette)                     │  │
│  │  • Raycast-style single dialog interface                          │  │
│  │  • Page-based navigation (home → tool-chat)                       │  │
│  │  • Tool discovery, search, and execution                          │  │
│  │  • Conversational AI for tool parameter gathering                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
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
│   │   ├── cli.ts                  # CLI commands (mcp:serve)
│   │   ├── di.ts                   # Module DI container
│   │   │
│   │   ├── lib/
│   │   │   ├── ai-sdk.ts           # AI SDK re-exports (streamText, providers)
│   │   │   ├── auth.ts             # MCP authentication logic
│   │   │   ├── chat-config.ts      # AI provider configuration
│   │   │   ├── client-factory.ts   # MCP client creation
│   │   │   ├── command-tools.ts    # Built-in command tools
│   │   │   ├── http-server.ts      # MCP HTTP server implementation
│   │   │   ├── in-process-client.ts # In-process MCP client (no network)
│   │   │   ├── mcp-client.ts       # MCP client implementation
│   │   │   ├── mcp-connection-manager.ts # Multi-server connection management
│   │   │   ├── mcp-server.ts       # MCP server implementation
│   │   │   ├── mcp-server-config.ts # External server configuration storage
│   │   │   ├── mcp-tool-adapter.ts # Converts MCP tools to AI SDK format
│   │   │   ├── tool-executor.ts    # Tool execution logic
│   │   │   ├── tool-loader.ts      # Discovers tools from all modules
│   │   │   ├── tool-registry.ts    # Global tool registration
│   │   │   └── types.ts            # Module-specific types
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
│       ├── utils/
│       │   ├── toolMatcher.ts       # Fuzzy tool search
│       │   └── contextBuilder.ts    # Context building utilities
│       │
│       └── components/CommandPalette/
│           ├── CommandPalette.tsx       # Main component (Raycast-style)
│           ├── CommandPaletteProvider.tsx # Context provider
│           ├── CommandHeader.tsx        # Back button + tool name
│           ├── CommandFooter.tsx        # Connection status + shortcuts
│           ├── CommandInput.tsx         # Search input
│           ├── HomePage.tsx             # Tool list + search + recent
│           ├── ToolChatPage.tsx         # Conversational tool UI
│           ├── ToolCallConfirmation.tsx # Tool execution confirmation
│           ├── ChatView.tsx             # Legacy chat view
│           ├── MessageBubble.tsx        # Chat message display
│           └── ...
```

## Key Concepts

### 1. MCP (Model Context Protocol)

MCP is a protocol for exposing tools to AI models. This module implements both server and client sides:

- **Server**: Exposes tools from all Open Mercato modules via HTTP
- **Client**: Connects to local (in-process) and external MCP servers

### 2. Tool Registration

Tools are registered from each module via `registerTool()`:

```typescript
import { registerTool } from '@open-mercato/ai-assistant'

registerTool({
  name: 'customers.search',
  description: 'Search for customers',
  module: 'customers',
  requiredFeatures: ['customers.view'],
  inputSchema: { /* JSON Schema */ },
  handler: async (args, context) => { /* implementation */ }
})
```

### 3. Command Palette Pages

The UI uses page-based navigation within a single dialog:

- **`home`**: Shows search input, recent tools, and tool list
- **`tool-chat`**: Conversational AI for a specific tool

### 4. Tool Execution Flow

1. User selects a tool → navigates to `tool-chat` page
2. AI assistant helps gather required parameters through conversation
3. When ready, tool call is proposed → user confirms
4. Tool executes via `/api/ai/tools/execute`
5. Result is displayed in the chat

### 5. Chat Modes

The chat API supports different modes:

- **`default`**: General chat with auto-executing tools
- **`tool-assist-confirm`**: Tool-specific chat where tool calls require user confirmation

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/ai/chat` | POST | Streaming chat with AI (supports modes) |
| `/api/ai/tools` | GET | List all available tools |
| `/api/ai/tools/execute` | POST | Execute a specific tool |
| `/api/ai/settings` | GET/POST | AI provider configuration |
| `/api/ai/mcp-servers` | GET/POST | External MCP server list/create |
| `/api/ai/mcp-servers/[id]` | GET/PUT/DELETE | Single MCP server operations |

## Permissions (ACL)

Defined in `acl.ts`:

| Feature ID | Description |
|------------|-------------|
| `ai_assistant.view` | View AI Assistant Settings |
| `ai_assistant.settings.manage` | Manage AI settings |
| `ai_assistant.mcp.serve` | Start MCP Server |
| `ai_assistant.tools.list` | List MCP Tools |
| `ai_assistant.mcp_servers.view` | View MCP server configs |
| `ai_assistant.mcp_servers.manage` | Manage MCP server configs |

## Frontend State Management

The command palette uses `useCommandPalette` hook which provides:

```typescript
interface CommandPaletteContextValue {
  state: {
    isOpen: boolean
    page: 'home' | 'tool-chat'
    inputValue: string
    selectedIndex: number
    isLoading: boolean
    isStreaming: boolean
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  }

  // Navigation
  goToToolChat: (tool: ToolInfo) => void
  goBack: () => void

  // Tool execution
  executeTool: (name: string, args?: object) => Promise<Result>
  approveToolCall: (id: string) => Promise<void>
  rejectToolCall: (id: string) => void

  // Chat
  sendToolMessage: (content: string) => Promise<void>
  // ...
}
```

## Common Tasks

### Adding a New Tool

1. In your module, call `registerTool()` with the tool definition
2. The tool will automatically be available in the command palette
3. Ensure proper `requiredFeatures` for access control

### Modifying the Command Palette UI

1. Components are in `src/frontend/components/CommandPalette/`
2. State logic is in `src/frontend/hooks/useCommandPalette.ts`
3. Types are in `src/frontend/types.ts`

### Adding a New AI Provider

1. Update `chat-config.ts` with provider info
2. Update `createModelClient()` in `/api/ai/chat/route.ts`
3. Add environment variable check

### Adding New Chat Features

1. Update the chat API route in `src/app/api/ai/chat/route.ts`
2. Add new mode handling if needed
3. Update frontend to handle new response types

## Testing

- TypeScript compilation: `npx tsc --noEmit -p packages/ai-assistant/tsconfig.json`
- The module integrates with the main app's test suite

## Dependencies

Key external dependencies:

- `ai` - Vercel AI SDK for streaming and tool calling
- `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` - AI providers
- `@modelcontextprotocol/sdk` - MCP SDK
- `cmdk` - Command palette UI library
- `zod` - Schema validation

## Critical Technical Details

### Zod 4 JSON Schema Conversion Issue

**Problem**: When using Zod 4 with the Vercel AI SDK, schemas containing `z.date()` or `z.coerce.date()` throw the error:
```
Error: Date cannot be represented in JSON Schema
```

**Root Cause**:
- Zod 4 introduced `z.toJSONSchema()` method for converting Zod schemas to JSON Schema
- The Vercel AI SDK internally uses this with `io: 'output'` option
- When a schema has `z.coerce.date()`, the INPUT is a string but the OUTPUT is a `Date` object
- With `io: 'output'`, the SDK sees the Date output type which cannot be represented in JSON Schema
- This causes the error when `streamText()` tries to send tools to the LLM API

**Why simple detection doesn't work**:
- `z.coerce.date()` creates a `ZodEffects` type, not `ZodDate`
- The Date is only visible when looking at the OUTPUT type after transformation
- Scanning the Zod schema structure doesn't reliably find all Date types

**Solution** (implemented in `mcp-tool-adapter.ts`):

The fix uses a "round-trip" conversion that strips out problematic types:

```
Original Zod Schema (with dates)
        │
        ▼
┌─────────────────────────────────────────────┐
│  z.toJSONSchema(schema, {                   │
│    unrepresentable: 'any'  ◄── Key option!  │
│  })                                         │
│                                             │
│  This converts Date types to { } (any)      │
│  instead of throwing an error               │
└─────────────────────────────────────────────┘
        │
        ▼
   JSON Schema (dates are now "any" type)
        │
        ▼
┌─────────────────────────────────────────────┐
│  jsonSchemaToZod(jsonSchema)                │
│                                             │
│  Converts JSON Schema back to Zod,          │
│  creating clean types:                      │
│  - "string" → z.string()                    │
│  - "number" → z.number()                    │
│  - "object" → z.object({...})               │
│  - "any"/unknown → z.unknown()              │
└─────────────────────────────────────────────┘
        │
        ▼
Clean Zod Schema (no Date types, AI SDK compatible)
```

**Code**:
```typescript
// In mcp-tool-adapter.ts

function toSafeZodSchema(schema: ZodType): ZodType {
  // Step 1: Convert to JSON Schema with unrepresentable: 'any'
  // This handles Date, Function, Symbol, etc. by making them 'any'
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' })

  // Step 2: Convert back to a simple Zod schema
  // The resulting schema only has JSON-safe types
  return jsonSchemaToZod(jsonSchema)
}

// Used when converting MCP tools for the AI SDK:
const safeSchema = toSafeZodSchema(mcpTool.inputSchema)
aiTools[mcpTool.name] = dynamicTool({
  inputSchema: safeSchema,  // Safe schema without Date types
  // ...
})
```

**Why this works**:
1. `unrepresentable: 'any'` tells Zod to NOT throw errors for Date types
2. The round-trip removes all Zod-specific features (transforms, effects, coercions)
3. The resulting schema only contains basic JSON types that the AI SDK can handle
4. The actual tool execution still uses the ORIGINAL schema for validation

**Files affected**:
- `lib/mcp-tool-adapter.ts` - Contains `toSafeZodSchema()` and `jsonSchemaToZod()`
- `lib/http-server.ts` - Uses the same pattern for MCP HTTP server

**Reference**: [GitHub Issue #11047](https://github.com/vercel/ai/issues/11047)

### Schema Sources with Date Fields

The following validators contain `z.coerce.date()` fields that require conversion:
- `packages/core/src/modules/sales/data/validators.ts` - Order dates, delivery dates
- `packages/core/src/modules/workflows/data/validators.ts` - Execution timestamps
- `packages/core/src/modules/customers/data/validators.ts` - Activity timestamps
- `packages/core/src/modules/business_rules/api/logs/route.ts` - Log date filters

### Command Tools Auto-Discovery

The `command-tools.ts` file automatically discovers and registers tools from command modules. It:

1. Scans all modules for `commands.ts` exports
2. Maps command operations (create, update, delete) to Zod schemas from validators
3. Registers tools with proper feature-based access control

**Schema Name Overrides** (in `command-tools.ts`):
```typescript
const SCHEMA_NAME_OVERRIDES: Record<string, string> = {
  'booking.resourceTypes': 'bookingResourceType',
  'booking.availability': 'bookingAvailabilityRule',
  'feature_toggles.global': 'toggle',
  // Add more when schema names don't match the expected pattern
}
```

## Debug Features

### Debug Panel for AI Chat

The Command Palette includes a debug panel (toggle button in footer) that displays:
- Tool call events (name, arguments)
- Tool result events (return values)
- Error events
- Connection status changes

**Files**:
- `frontend/components/CommandPalette/DebugPanel.tsx` - Debug panel component
- `frontend/hooks/useCommandPalette.ts` - Debug event tracking via `addDebugEvent()`

**Usage**: Click the "Debug" button in the command palette footer to toggle the debug panel.

### Debug Event Types

```typescript
type DebugEventType = 'tool-call' | 'tool-result' | 'text' | 'error' | 'done' | 'message' | 'connection'

interface DebugEvent {
  id: string
  timestamp: Date
  type: DebugEventType
  data: unknown
}
```

## Chat Modes

### Agentic Mode (Default)

The chat API uses "agentic" mode by default, which allows the AI to:
- Make multiple tool calls in sequence
- Process tool results and continue reasoning
- Handle up to 20 agentic steps (configurable via `stepCountIs(20)`)

**Configuration** (in `/api/ai/chat/route.ts`):
```typescript
const result = streamText({
  model,
  system: systemPrompt,
  messages,
  tools: hasTools ? aiTools : undefined,
  stopWhen: stepCountIs(20), // Max 20 tool call steps
})
```

## MCP Tool Adapter

The `mcp-tool-adapter.ts` converts MCP tools to Vercel AI SDK format:

```typescript
export function convertMcpToolsToAiSdk(
  mcpClient: InProcessMcpClient,
  mcpTools: ToolInfoWithSchema[]
): Record<string, Tool<unknown, unknown>>
```

**Key responsibilities**:
1. Convert Zod schemas to AI SDK-compatible format (handling Date types)
2. Wrap tool execution with MCP client calls
3. Format tool results for LLM consumption
4. Cache converted schemas for performance

## Changelog

### 2026-01 - CLI Tools Fix & Organization-Scoped API Keys

**Problem**: CLI tools executed through MCP server failed with "ORM entities not registered" error due to tsx/esbuild module duplication.

**Root Cause**: When mixing dynamic imports (`await import()`) with static imports, tsx loads the same file as multiple separate module instances. This is a known issue: [tsx Issue #499](https://github.com/privatenumber/tsx/issues/499). The bootstrap code registered entities in Module Instance A, but cli-tool-loader.ts read from Module Instance B.

**Solution** (in `lib/cli-tool-loader.ts`):
1. Use **static imports** for registration functions (same module instances as tool handlers)
2. **Dynamically import only the DATA** (entities, diRegistrars arrays from generated files)
3. Call registration functions directly in `ensureBootstrapInThisContext()`

```typescript
// Static imports ensure we use the SAME module instances
import { getDiRegistrars, registerDiRegistrars } from '@open-mercato/shared/lib/di/container'
import { registerOrmEntities, getOrmEntities } from '@open-mercato/shared/lib/db/mikro'

async function ensureBootstrapInThisContext(): Promise<void> {
  try {
    getOrmEntities()
    getDiRegistrars()
    return // Already available
  } catch {
    // Not available, need to register from generated files
  }
  // ... import generated data and register
}
```

**Console Output Capture**: CLI tools now capture `console.log/error/warn/info` output and return it in the MCP response instead of printing to server console.

**Organization-Scoped API Keys**: CLI seed commands require `organizationId`. API keys can be:
- **Tenant-wide** (`organizationId = null`) - Full tenant access, system integrations
- **Organization-scoped** (`organizationId = UUID`) - Limited to specific organization

To create an organization-scoped API key for MCP:
```bash
yarn mercato api_keys add \
  --name "MCP Assistant (Org Name)" \
  --tenantId <tenant-uuid> \
  --organizationId <org-uuid> \
  --roles <superadmin-role-uuid>
```

Then update `.mcp.json` with the new key and restart Claude Code (not just `/mcp` reconnect).

**Files Modified**:
- `lib/cli-tool-loader.ts` - Bootstrap fix + output capture
- `@open-mercato/shared/lib/di/container.ts` - globalThis pattern for DI registrars

#### Testing Plan for CLI Tools & Organization-Scoped API Key

**Pre-requisites**:
1. Restart Claude Code completely (not just `/mcp` reconnect) to load new API key
2. MCP HTTP server running: `yarn mercato ai_assistant mcp:serve-http --port 3001`

**Tests**:

| Test | Action | Expected Result | Pass Criteria |
|------|--------|-----------------|---------------|
| 1 | `context_whoami` | `organizationId` not null, new key ID | Verify org-scoped key is active |
| 2 | `cli_auth_list_orgs` | `success: true`, output has org list | CLI execution works |
| 3 | `cli_auth_list_users` | `success: true`, output has user list | DB/ORM access works |
| 4 | `cli_currencies_seed` | `success: true`, currencies seeded | Seed with org context works |
| 5 | `cli_customers_seed_dictionaries` | `success: true`, dictionaries seeded | Multiple seeds work |
| 6 | `search_status` | Returns search module status | Non-CLI tools work |
| 7 | `customers_companies_create` with `{"displayName": "Test"}` | Company created, returns ID | Write operations work |
| 8 | `customers_companies_delete` with ID from test 7 | Company deleted | Delete operations work |

**Failure Troubleshooting**:

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `organizationId: null` in whoami | Old API key still in use | Fully restart Claude Code |
| "ORM entities not registered" | Bootstrap not called | Check `ensureBootstrapInThisContext()` |
| "Connection refused" | MCP server not running | Start server on port 3001 |
| Empty output in CLI tools | Console capture not working | Check `captureConsoleOutput()` |
| "Missing organizationId" | API key not org-scoped | Verify key has organizationId set |

### 2025-01 - Zod 4 Schema Handling & Debug Panel

- Fixed "Date cannot be represented in JSON Schema" error with Zod 4
- Added `toSafeZodSchema()` for safe schema conversion
- Added `jsonSchemaToZod()` for JSON Schema to Zod conversion
- Added Debug Panel for AI chat (tool calls, results, errors)
- Added markdown rendering for assistant messages
- Increased max agentic steps from 5 to 20
- Added visually hidden DialogTitle for accessibility

### 2024-01 - Raycast-Style Command Palette Rewrite

- Replaced mode-based system with page-based navigation
- Added `HomePage`, `ToolChatPage`, `ToolCallConfirmation` components
- Added `CommandHeader`, `CommandFooter` components
- Added `useRecentTools` hook for tool tracking
- Added `tool-assist-confirm` chat mode for tool-specific conversations
- Added connection status indicator
- Tools now require user confirmation before execution

---

## Future Development: AI Agent Authorization & Impersonation

> **Status**: Planned - Not yet implemented

This section documents the planned architecture for enhanced AI authorization with proper impersonation, audit trails, and rate limiting.

### Problem Statement

When an AI agent executes actions on behalf of a user, the system must:
1. **Impersonate correctly** - Act with the user's permissions, not more
2. **Distinguish actors** - Know when "AI did X" vs "User did X"
3. **Audit comprehensively** - Track all AI actions for compliance
4. **Enforce constraints** - Limit AI's scope when appropriate
5. **Maintain security** - Prevent privilege escalation or cross-tenant access

### Current Gaps

| Gap | Risk | Impact |
|-----|------|--------|
| No actor distinction | Can't tell user vs AI actions | Audit/compliance failure |
| No AI session tracking | No correlation of AI actions | Debugging impossible |
| No operation limits | AI can make unlimited calls | Resource exhaustion |
| No scoped permissions | AI has full user permissions | Over-privilege risk |
| No audit events | AI actions not logged | Compliance violation |

### Proposed Architecture: Actor + Subject Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENHANCED AUTHORIZATION MODEL                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐         ┌──────────────┐                      │
│  │    ACTOR     │         │   SUBJECT    │                      │
│  │  (Who's      │         │  (On whose   │                      │
│  │   acting)    │         │   behalf)    │                      │
│  └──────────────┘         └──────────────┘                      │
│        │                        │                                │
│        ▼                        ▼                                │
│  ┌──────────────────────────────────────────────┐               │
│  │              EXECUTION CONTEXT                │               │
│  │                                               │               │
│  │  actor: { type, id, sessionId }              │               │
│  │  subject: { userId, tenantId, features }     │               │
│  │  constraints: { mode, limits, blocklist }    │               │
│  │  audit: { conversationId, requestId }        │               │
│  └──────────────────────────────────────────────┘               │
│                        │                                         │
│                        ▼                                         │
│              ┌─────────────────┐                                │
│              │  TOOL EXECUTOR  │                                │
│              │  with Audit     │                                │
│              └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

### Key Types (Planned)

```typescript
/** Actor performing the action */
interface ExecutionActor {
  type: 'user' | 'ai-assistant' | 'api-key' | 'system'
  id: string
  sessionId: string | null
  metadata?: {
    conversationId?: string
    model?: string
    provider?: string
  }
}

/** Subject whose permissions are used */
interface ExecutionSubject {
  userId: string
  tenantId: string | null
  organizationId: string | null
  features: string[]
  isSuperAdmin: boolean
}

/** Constraints on what actor can do */
interface ExecutionConstraints {
  mode: 'read-only' | 'standard' | 'full'
  maxToolCalls?: number
  maxMutations?: number
  requireConfirmationFor?: string[]
  blockedTools?: string[]
  expiresAt?: Date
}

/** Enhanced execution context */
interface AiExecutionContext {
  actor: ExecutionActor
  subject: ExecutionSubject
  constraints: ExecutionConstraints
  container: AwilixContainer
  counters: { toolCalls: number; mutations: number; startedAt: Date }
}

/** Audit event for compliance */
interface AiAuditEvent {
  eventType: 'tool-call' | 'tool-result' | 'confirmation-required' | 'error' | 'session-start' | 'session-end'
  timestamp: Date
  actor: ExecutionActor
  subject: Pick<ExecutionSubject, 'userId' | 'tenantId' | 'organizationId'>
  tool?: { name: string; args: Record<string, unknown>; result?: unknown; durationMs?: number }
  conversationId: string
  requestId: string
}
```

### Permission Tiers (Planned)

| Tier | Tool Calls | Mutations | Confirmation Required | Use Case |
|------|------------|-----------|----------------------|----------|
| Read-Only | 100 | 0 | N/A | Viewers, analysts |
| Standard | 50 | 10 | delete, remove, reindex | Regular users |
| Elevated | 100 | 25 | delete, remove | Managers |
| Unrestricted | ∞ | ∞ | None | Super admins |

Tier is auto-resolved from user's ACL features.

### Services to Implement

1. **AiSessionManager** (`lib/ai-session.ts`)
   - `createSession(auth, acl, options)` - Create AI session with constraints
   - `recordToolCall(sessionId, toolName, isMutation)` - Track and enforce limits
   - `endSession(sessionId, reason)` - Cleanup

2. **AiAuditService** (`lib/ai-audit.ts`)
   - `record(event)` - Log audit event
   - `query(params)` - Search audit log
   - `getSummary(params)` - Statistics

3. **executeToolWithContext** (`lib/tool-executor.ts`)
   - Enhanced executor with limits, audit, and confirmation flow

### Security Properties

1. **Downgrade only** - Constraints can be stricter than user permissions, never looser
2. **Tenant immutability** - tenantId cannot change during session
3. **Rate limiting** - Prevents runaway AI from exhausting resources
4. **Full audit trail** - Every tool call logged with actor, subject, timing

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `lib/types.ts` | Modify | Add ExecutionActor, ExecutionSubject, etc. |
| `lib/ai-session.ts` | Create | AiSessionManager class |
| `lib/ai-audit.ts` | Create | AiAuditService class |
| `lib/permission-tiers.ts` | Create | Tier definitions |
| `lib/tool-executor.ts` | Modify | Add executeToolWithContext |
| `/api/ai/chat/route.ts` | Modify | Create session, use execution context |

### Open Design Questions

1. **Audit storage**: Database table vs Event stream vs External service
2. **Session persistence**: In-memory vs Redis vs Database
3. **Tier assignment**: Automatic from features vs Explicit admin setting
4. **Confirmation UX**: Modal dialog vs Inline vs Approval queue
