# AI Assistant Module

AI-powered chat and tool execution for Open Mercato, using MCP (Model Context Protocol) for tool discovery and execution.

## What This Module Does

- **AI Chat Interface**: Dockable chat panel (`Cmd+J`) for natural language interaction
- **MCP Server**: Exposes platform tools to AI agents via Model Context Protocol
- **API Discovery**: Meta-tools (`api_discover`, `api_execute`, `api_schema`) for dynamic API access
- **OpenCode Integration**: Go-based AI backend for processing requests and executing tools

## Quick Start

### Prerequisites

- Node.js 24+
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
# GOOGLE_GENERATIVE_AI_API_KEY=AIza...
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
| `GOOGLE_GENERATIVE_AI_API_KEY` | If using Google | - | Google Generative AI API key |
| `DEEPINFRA_API_KEY` | If using DeepInfra | - | DeepInfra API key (OpenAI-compatible preset) |
| `GROQ_API_KEY` | If using Groq | - | Groq API key (OpenAI-compatible preset) |
| `TOGETHER_API_KEY` | If using Together | - | Together AI API key |
| `FIREWORKS_API_KEY` | If using Fireworks | - | Fireworks AI API key |
| `AZURE_OPENAI_API_KEY` | If using Azure | - | Azure OpenAI API key |
| `AZURE_OPENAI_BASE_URL` | If using Azure | - | Azure deployment URL |
| `LITELLM_API_KEY` | If using LiteLLM | - | LiteLLM proxy API key |
| `LITELLM_BASE_URL` | If using LiteLLM | `http://localhost:4000/v1` | LiteLLM proxy URL |
| `OLLAMA_API_KEY` | If using Ollama | `ollama` | Ollama API key (usually `ollama`) |
| `OLLAMA_BASE_URL` | If using Ollama | `http://localhost:11434/v1` | Ollama local URL |
| `OPENCODE_PROVIDER` | Yes | - | LLM provider id (any registered provider, see below) |
| `OPENCODE_MODEL` | No | See table below | Override the model for selected provider |
| `MCP_SERVER_API_KEY` | For production | - | Open Mercato API key (`omk_...`) for MCP server auth |
| `MCP_DEV_PORT` | No | `3001` | Port for development MCP server |
| `MCP_DEBUG` | No | `false` | Enable debug logging |
| `OPENCODE_URL` | No | `http://localhost:4096` | OpenCode server URL |

### Built-in Providers

The registry ships 10 built-in providers via the ports & adapters
architecture (see [`.ai/specs/2026-04-14-llm-provider-ports-and-adapters.md`](../../.ai/specs/2026-04-14-llm-provider-ports-and-adapters.md)).

Native protocol adapters:

| Provider id | SDK | Default model | Context |
|-------------|-----|---------------|---------|
| `anthropic` | `@ai-sdk/anthropic` | `claude-haiku-4-5-20251001` | 200K |
| `google` | `@ai-sdk/google` | `gemini-3-flash` | 1M |

OpenAI-compatible presets (all share one protocol adapter with different
`baseURL` and env keys):

| Provider id | Base URL | Default model | Context |
|-------------|----------|---------------|---------|
| `openai` | `api.openai.com` | `gpt-5-mini` | 128K |
| `deepinfra` | `api.deepinfra.com/v1/openai` | `zai-org/GLM-5.1` | 202K |
| `groq` | `api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | 131K |
| `together` | `api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | 131K |
| `fireworks` | `api.fireworks.ai/inference/v1` | `llama-v3p3-70b-instruct` | 131K |
| `azure` | `$AZURE_OPENAI_BASE_URL` | `gpt-5-mini` | 128K |
| `litellm` | `$LITELLM_BASE_URL` | `gpt-4o-mini` | 128K |
| `ollama` | `$OLLAMA_BASE_URL` | `llama3.3` | 131K |

DeepInfra preset ships a curated model catalog including `GLM-5.1`,
`GLM-4.7-Flash`, `Qwen3-235B-A22B-Instruct-2507`,
`Llama-4-Scout-17B-16E-Instruct`, `DeepSeek-V3.2-Exp`, and
`Qwen3-Coder-30B-A3B-Instruct`.

### Extending with Custom Providers

Downstream applications can register their own providers at bootstrap
time without forking this package. Example adding a custom LiteLLM
proxy that routes to multiple upstream backends:

```ts
// src/bootstrap.ts (downstream app)
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { createOpenAICompatibleProvider } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/openai'

llmProviderRegistry.register(
  createOpenAICompatibleProvider({
    id: 'internal-litellm',
    name: 'Internal LiteLLM',
    baseURL: process.env.INTERNAL_LITELLM_URL!,
    envKeys: ['INTERNAL_LITELLM_KEY'],
    defaultModel: 'internal/gpt-5',
    defaultModels: [
      { id: 'internal/gpt-5', name: 'GPT-5 (internal)', contextWindow: 128000 },
    ],
  }),
)
```

The custom provider is immediately available under its id in
`OPENCODE_PROVIDER`, the backend settings dropdown, and the routing
layer — no changes needed in core.

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

- Authenticates **once at startup** using API key from `.mcp.json`
- No session tokens required per request
- Tools filtered by API key permissions at startup
- **Default port: 3001** (configurable via `MCP_DEV_PORT` env var)
- No port argument needed

```bash
# Start on default port 3001
yarn mcp:dev

# Or override port via environment variable
MCP_DEV_PORT=3002 yarn mcp:dev
```

#### Production Server (`yarn mcp:serve`)

For web-based AI chat interface:

- **Requires `--port` argument** (no default port)
- Clients authenticate via `x-api-key` header on each request
- API keys validated against database
- Per-request permission checks
- Supports session tokens for user-level auth

```bash
# Start on specified port (required)
yarn mcp:serve -- --port 3001

# With debug logging
yarn mcp:serve -- --port 3001 --debug
```

### Comparison

| Feature | Dev (`mcp:dev`) | Production (`mcp:serve`) |
|---------|-----------------|-------------------------|
| Port | Default 3001 (`MCP_DEV_PORT`) | **Required** (`--port`) |
| Auth source | `.mcp.json` file | `x-api-key` header per request |
| Permission check | Once at startup | Per request |
| Session tokens | Not required | Optional (for user-level auth) |
| Use case | Claude Code, local dev | Web AI chat, production |

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
yarn generate
```

This scans all modules for `ai-tools.ts` files and generates `ai-tools.generated.ts` in `.mercato/generated/`.

### Registration Flow

1. Create `ai-tools.ts` in your module
2. Run `yarn generate` (or it runs automatically during `predev`/`prebuild`)
3. Tools are available in the MCP server

**Example**: See `packages/search/src/modules/search/ai-tools.ts` for a complete implementation with search-related tools.

---

## CLI Commands

```bash
# Start development MCP server (for Claude Code)
# Uses API key from .mcp.json, default port 3001
yarn mcp:dev

# Start production MCP server (for web chat)
# Requires --port argument
yarn mcp:serve -- --port 3001

# List all available MCP tools
yarn mercato ai_assistant mcp:list-tools

# List tools with descriptions
yarn mercato ai_assistant mcp:list-tools --verbose

# Extract entity relationship graph
yarn mercato ai_assistant entity-graph
yarn mercato ai_assistant entity-graph --format json
yarn mercato ai_assistant entity-graph --module sales
yarn mercato ai_assistant entity-graph --entity SalesOrder
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
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_GENERATIVE_AI_API_KEY:-}  # Set if using google
      OPENCODE_MCP_URL: ${OPENCODE_MCP_URL:-http://host.docker.internal:3001/mcp}
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY}      # Required
    ports:
      - "4096:4096"
```

Start with:
```bash
docker-compose up opencode
```
