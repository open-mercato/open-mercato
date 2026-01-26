# AI Assistant Module

AI-powered chat and tool execution for Open Mercato, using MCP (Model Context Protocol) for tool discovery and execution.

## What This Module Does

- **AI Chat Interface**: Dockable chat panel (`Cmd+J`) for natural language interaction
- **MCP Server**: Exposes platform tools to AI agents via Model Context Protocol
- **API Discovery**: Meta-tools (`api_discover`, `api_execute`, `api_schema`) for dynamic API access
- **OpenCode Integration**: Go-based AI backend for processing requests and executing tools

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for OpenCode)
- An LLM API key (Anthropic, OpenAI, or Google)
- An Open Mercato API key (created via Backend > Settings > API Keys)

### Step 1: Configure LLM Provider

Add your LLM provider configuration to `.env`. You need both the provider selection and its API key:

```bash
# Choose ONE provider and set BOTH values

# Option A: Anthropic
OPENCODE_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...

# Option B: OpenAI
# OPENCODE_PROVIDER=openai
# OPENAI_API_KEY=sk-...

# Option C: Google
# OPENCODE_PROVIDER=google
# GOOGLE_API_KEY=AIza...
```

### Step 2: Configure MCP Server

The MCP server authenticates requests using an Open Mercato API key:

1. Log into Open Mercato backend
2. Go to **Settings > API Keys**
3. Create a new API key with appropriate permissions
4. Copy the key (starts with `omk_`) and add it to `.env`:

```bash
# .env
MCP_SERVER_API_KEY=omk_your_api_key_here
```

### Step 3: Create .mcp.json for Claude Code Integration (Optional)

If you want to use Claude Code with your MCP server, create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "open-mercato": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "x-api-key": "omk_your_api_key_here"
      }
    }
  }
}
```

The `x-api-key` should be an Open Mercato API key created in the backend admin (Settings > API Keys).

### Step 4: Start Services

```bash
# Terminal 1: Start MCP development server
yarn mcp:dev

# Terminal 2: Start OpenCode container
docker-compose up opencode

# Terminal 3: Start Next.js app
yarn dev
```

### Step 5: Verify Setup

```bash
# Check MCP server health
curl http://localhost:3001/health

# Check OpenCode health
curl http://localhost:4096/global/health

# Check MCP connection from OpenCode
curl http://localhost:4096/mcp
```

### Step 6: Use the AI Assistant

- **Keyboard**: Press `Cmd+J` (Mac) or `Ctrl+J` (Windows/Linux)
- **Header**: Click the sparkles icon
- **Command Palette**: Press `Cmd+K` and type a question

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | If using Anthropic | - | Anthropic API key |
| `OPENAI_API_KEY` | If using OpenAI | - | OpenAI API key |
| `GOOGLE_API_KEY` | If using Google | - | Google API key |
| `OPENCODE_PROVIDER` | Yes | - | LLM provider: `anthropic`, `openai`, or `google` |
| `OPENCODE_MODEL` | No | See table below | Override the model for selected provider |
| `MCP_SERVER_API_KEY` | For production | - | Open Mercato API key (`omk_...`) for MCP server auth |
| `MCP_DEV_PORT` | No | `3001` | Port for development MCP server |
| `MCP_DEBUG` | No | `false` | Enable debug logging |
| `OPENCODE_URL` | No | `http://localhost:4096` | OpenCode server URL |

### Models by Provider

If `OPENCODE_MODEL` is not set, these models are used:

| Provider | Model | Context Window |
|----------|---------------|----------------|
| `anthropic` | `claude-haiku-4-5-20251001` | 200K tokens |
| `openai` | `gpt-5-mini` | 128K tokens |
| `google` | `gemini-3-flash-preview` | 1M tokens |

### .mcp.json Configuration

For Claude Code integration, create `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "open-mercato": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "x-api-key": "omk_your_api_key_here"
      }
    }
  }
}
```

The `x-api-key` value must be a valid Open Mercato API key:
1. Log into Open Mercato backend
2. Go to Settings > API Keys
3. Create a new API key with appropriate permissions
4. Copy the key (starts with `omk_`)

---

## Architecture

### High-Level Flow

```
Browser (Cmd+J)
    |
    v
/api/chat (SSE stream)
    |
    v
OpenCode Server (:4096)
    |
    v
MCP Server (:3001)
    |
    v
Platform Tools (customers, sales, catalog, search...)
```

### Components

1. **Chat UI** - Dockable panel in the frontend
2. **Chat API** (`/api/chat`) - SSE endpoint that bridges frontend to OpenCode
3. **OpenCode** - Go-based AI agent running in Docker
4. **MCP Server** - HTTP server exposing tools via Model Context Protocol
5. **Tool Registry** - Registered tools from all modules

### MCP Server Modes

#### Development Server (`yarn mcp:dev`)

For local development and Claude Code integration:

- Authenticates once at startup using API key from `.mcp.json`
- No session tokens required per request
- Tools filtered by API key permissions at startup
- Port: 3001 (or `MCP_DEV_PORT`)

```bash
yarn mcp:dev
```

#### Production Server (`yarn mcp:serve`)

For web-based AI chat interface:

- Two-tier authentication:
  1. Server-level: `x-api-key` header validated against `MCP_SERVER_API_KEY`
  2. User-level: `_sessionToken` parameter in each tool call
- Per-request permission checks
- Session tokens auto-generated with 2-hour TTL

```bash
yarn mcp:serve  # Uses MCP_SERVER_API_KEY from .env
```

### Comparison

| Feature | Dev (`mcp:dev`) | Production (`mcp:serve`) |
|---------|-----------------|-------------------------|
| Auth | API key only | API key + session tokens |
| Permission check | Once at startup | Per tool call |
| Session tokens | Not required | Required |
| Use case | Claude Code, local dev | Web AI chat |

---

## API Discovery Tools

Instead of exposing hundreds of individual API endpoints as tools, the module provides three meta-tools for dynamic API discovery and execution:

| Tool | Description |
|------|-------------|
| `api_discover` | Search for APIs by keyword, module, or HTTP method |
| `api_schema` | Get detailed schema for a specific endpoint |
| `api_execute` | Execute an API call with parameters |

### Example Workflow

1. User asks: "Find all customers in New York"
2. AI calls `api_discover("customers search")`
3. AI calls `api_schema("/api/v1/customers")` to see parameters
4. AI calls `api_execute({ method: "GET", path: "/api/v1/customers", query: { city: "New York" } })`

---

## Frontend Components

### Integration

```tsx
import {
  AiAssistantIntegration,
  AiChatHeaderButton,
} from '@open-mercato/ai-assistant/frontend'

function Layout({ children }) {
  return (
    <AiAssistantIntegration tenantId={auth.tenantId} organizationId={auth.orgId}>
      <Header>
        <AiChatHeaderButton />
      </Header>
      {children}
    </AiAssistantIntegration>
  )
}
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+J` / `Ctrl+J` | Open AI chat directly |
| `Cmd+K` / `Ctrl+K` | Open command palette |
| `Escape` | Close chat or reset |
| `Enter` | Submit message |

### Dockable Chat Panel

The chat panel supports multiple positions:

| Mode | Description |
|------|-------------|
| Modal | Centered overlay (default) |
| Dock Right | Fixed panel on right side |
| Dock Left | Fixed panel on left side |
| Dock Bottom | Fixed panel at bottom |

Position preference is persisted in localStorage.

---

## Module AI Tools

Modules can expose AI tools by creating an `ai-tools.ts` file. These tools are **automatically discovered** by the generator and loaded at MCP server startup - no manual registration required.

### File Location

Create the file at: `src/modules/<module>/ai-tools.ts`

For packages: `packages/<package>/src/modules/<module>/ai-tools.ts`

### Structure

```typescript
import { z } from 'zod'
import type { McpToolContext } from '@open-mercato/ai-assistant'

type AiToolDefinition = {
  name: string                    // Tool name (module_action format, no dots)
  description: string             // Human-readable description
  inputSchema: z.ZodType<any>     // Zod schema for input validation
  requiredFeatures?: string[]     // ACL features required
  handler: (input: any, ctx: McpToolContext) => Promise<unknown>
}

export const aiTools: AiToolDefinition[] = [
  {
    name: 'my_module_action',
    description: 'Description of what this tool does',
    inputSchema: z.object({
      param1: z.string().describe('Description of param1'),
      param2: z.number().optional(),
    }),
    requiredFeatures: ['my_module.action'],
    handler: async (input, ctx) => {
      const service = ctx.container.resolve('myService')
      return { success: true }
    },
  },
]
```

### Auto-Discovery

Tools are automatically discovered when you run the module generator:

```bash
npm run modules:prepare
```

This scans all modules for `ai-tools.ts` files and generates `ai-tools.generated.ts` in `.mercato/generated/`.

### Registration Flow

1. Create `ai-tools.ts` in your module
2. Run `npm run modules:prepare` (or it runs automatically during `predev`/`prebuild`)
3. Tools are available in the MCP server

**Example**: See `packages/search/src/modules/search/ai-tools.ts` for a complete implementation with search-related tools.

---

## CLI Commands

```bash
# Start development MCP server (for Claude Code)
yarn mcp:dev

# Start production MCP server (for web chat)
yarn mcp:serve

# List all available MCP tools
yarn mercato ai_assistant mcp:list-tools

# List tools with descriptions
yarn mercato ai_assistant mcp:list-tools --verbose
```

---

## Permissions (ACL)

| Feature ID | Description |
|------------|-------------|
| `ai_assistant.view` | View AI Assistant |
| `ai_assistant.settings.manage` | Manage AI settings |
| `ai_assistant.mcp.serve` | Start MCP Server |
| `ai_assistant.tools.list` | List MCP Tools |
| `ai_assistant.mcp_servers.view` | View MCP server configs |
| `ai_assistant.mcp_servers.manage` | Manage MCP server configs |

---

## Troubleshooting

### Verify Connectivity

```bash
# MCP server health
curl http://localhost:3001/health
# Expected: {"status":"ok","mode":"development","tools":10}

# OpenCode health
curl http://localhost:4096/global/health
# Expected: {"healthy":true,"version":"..."}

# MCP connection from OpenCode
curl http://localhost:4096/mcp
# Expected: {"open-mercato":{"status":"connected"}}
```

### Debug Mode

Enable debug logging:

```bash
MCP_DEBUG=true yarn mcp:dev
```

In the chat UI, click "Debug" in the footer to see tool calls and results.

---

## Directory Structure

```
packages/ai-assistant/
├── src/
│   ├── index.ts                    # Package exports
│   ├── di.ts                       # Dependency injection
│   ├── types.ts                    # Shared types
│   │
│   ├── modules/ai_assistant/
│   │   ├── acl.ts                  # Permission definitions
│   │   ├── cli.ts                  # CLI commands
│   │   │
│   │   ├── lib/
│   │   │   ├── opencode-client.ts      # OpenCode API client
│   │   │   ├── opencode-handlers.ts    # Request handlers
│   │   │   ├── api-discovery-tools.ts  # api_discover, api_execute, api_schema
│   │   │   ├── http-server.ts          # MCP HTTP server
│   │   │   ├── mcp-dev-server.ts       # Development MCP server
│   │   │   └── tool-registry.ts        # Tool registration
│   │   │
│   │   └── api/chat/
│   │       └── route.ts            # POST /api/chat handler
│   │
│   └── frontend/
│       ├── index.ts                # Frontend exports
│       ├── components/
│       │   ├── DockableChat/       # Main chat component
│       │   ├── AiAssistantIntegration.tsx
│       │   └── AiChatHeaderButton.tsx
│       └── hooks/
│           ├── useCommandPalette.ts
│           └── useMcpTools.ts
│
└── README.md                       # This file
```

---

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/chat` | POST | Streaming chat with AI (SSE) |
| `/api/tools` | GET | List available tools |
| `/api/tools/execute` | POST | Execute a specific tool |
| `/api/settings` | GET | AI provider configuration |
| `/api/mcp-servers` | GET/POST | External MCP server management |

### Chat API

**Request:**
```typescript
{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  sessionId?: string  // For continuing conversation
}
```

**SSE Events:**
```typescript
| { type: 'thinking' }
| { type: 'text'; content: string }
| { type: 'tool-call'; id: string; toolName: string; args: unknown }
| { type: 'tool-result'; id: string; result: unknown }
| { type: 'done'; sessionId: string }
| { type: 'error'; error: string }
```

---

## Session Management

### How Sessions Work

1. **First message**: Chat API creates a session token (2-hour TTL)
2. **Token injection**: Token is injected into the message for OpenCode
3. **Tool calls**: Each tool call includes `_sessionToken` parameter
4. **Permission check**: MCP server resolves user permissions from token
5. **Expiry**: After 2 hours of inactivity, session expires

### Session Expiry

When a session expires, the AI receives:
> "Your chat session has expired. Please close and reopen the chat window to continue."

The AI will relay this message naturally to the user.

---

## Docker Configuration

The OpenCode container is configured via `docker-compose.yml`. It reads environment variables from your `.env` file:

```yaml
services:
  opencode:
    build: ./docker/opencode
    environment:
      OPENCODE_PROVIDER: ${OPENCODE_PROVIDER}        # Required
      OPENCODE_MODEL: ${OPENCODE_MODEL:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}      # Set if using anthropic
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}            # Set if using openai
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_API_KEY:-}  # Set if using google
      OPENCODE_MCP_URL: ${OPENCODE_MCP_URL:-http://host.docker.internal:3001/mcp}
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY}      # Required
    ports:
      - "4096:4096"
```

Start with:
```bash
docker-compose up opencode
```
