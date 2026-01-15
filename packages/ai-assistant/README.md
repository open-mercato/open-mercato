# AI Assistant Module

AI-powered assistance capabilities for Open Mercato, featuring a Raycast-style command palette interface, agentic AI chat with tool execution, and MCP (Model Context Protocol) integration.

## Features

- **Command Palette** - Raycast-style single dialog interface (Cmd+K)
- **Agentic AI Chat** - AI that can use tools to perform actions
- **MCP Server** - Exposes tools from all modules to external AI clients
- **Multi-Provider Support** - OpenAI, Anthropic, Google AI
- **Tool Auto-Discovery** - Automatically registers tools from all modules
- **ACL-Based Access Control** - Tools filtered by user permissions

## Architecture Overview

```mermaid
graph TB
    subgraph Frontend["Frontend (Browser)"]
        CP[Command Palette]
        Hook[useCommandPalette Hook]
        CP --> Hook
    end

    subgraph API["Next.js API Routes"]
        ChatAPI["/api/ai/chat"]
        ToolsAPI["/api/ai/tools"]
        SettingsAPI["/api/ai/settings"]
    end

    subgraph AIAssistant["AI Assistant Module"]
        MCP[MCP Client]
        Registry[Tool Registry]
        Adapter[MCP Tool Adapter]
        Config[Chat Config]
    end

    subgraph Providers["AI Providers"]
        OpenAI[OpenAI]
        Anthropic[Anthropic]
        Google[Google AI]
    end

    subgraph Modules["Application Modules"]
        Customers[Customers]
        Sales[Sales]
        Products[Products]
        Search[Search]
        Other[...]
    end

    Hook --> ChatAPI
    ChatAPI --> MCP
    ChatAPI --> Config
    Config --> Providers
    MCP --> Registry
    MCP --> Adapter
    Adapter --> Providers

    Modules --> Registry
```

## User Interaction Flow

```mermaid
sequenceDiagram
    actor User
    participant CP as Command Palette
    participant Hook as useCommandPalette
    participant API as /api/ai/chat
    participant AI as AI Provider
    participant Tools as Tool Registry

    User->>CP: Press Cmd+K
    CP->>Hook: open()
    Hook->>CP: Show palette (idle phase)

    User->>CP: Type query
    CP->>Hook: handleSubmit(query)
    Hook->>Hook: Set phase to 'chatting'

    Hook->>API: POST /api/ai/chat (agentic mode)
    API->>Tools: listToolsWithSchemas()
    Tools-->>API: Available tools
    API->>AI: streamText with tools

    loop SSE Stream
        AI-->>API: text-delta / tool-call / tool-result
        API-->>Hook: SSE event
        Hook->>CP: Update messages
    end

    AI-->>API: done
    API-->>Hook: done event
    Hook->>CP: Final state
```

## Tool Execution Flow

```mermaid
flowchart TD
    subgraph User Query
        A[User asks: "Find all customers in New York"]
    end

    subgraph AI Processing
        B[AI receives query + available tools]
        C{AI decides to call tool}
        D[AI calls search_query tool]
    end

    subgraph Server Side Execution
        E[Tool executed via MCP Client]
        F[Tool Registry finds handler]
        G[Handler executes with auth context]
        H[Results returned to AI]
    end

    subgraph AI Response
        I[AI interprets results]
        J[AI generates human-friendly response]
        K["Response: 'I found 15 customers in New York...'"]
    end

    A --> B
    B --> C
    C -->|Yes| D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
    C -->|No| J
```

## SSE Streaming Protocol

```mermaid
sequenceDiagram
    participant Client as Frontend
    participant Server as /api/ai/chat
    participant AI as AI Provider
    participant Tool as Tool Handler

    Client->>Server: POST (messages, mode: 'agentic')
    Server->>AI: streamText()

    AI-->>Server: text-delta
    Server-->>Client: data: {"type":"text","content":"..."}

    AI-->>Server: tool-call
    Server-->>Client: data: {"type":"tool-call","toolName":"search_query","args":{...}}

    Server->>Tool: Execute tool
    Tool-->>Server: Result

    Server-->>Client: data: {"type":"tool-result","toolName":"search_query","result":{...}}

    AI-->>Server: text-delta (interpreting results)
    Server-->>Client: data: {"type":"text","content":"..."}

    AI-->>Server: finish
    Server-->>Client: data: {"type":"done"}
    Client->>Client: Finalize UI
```

## Tool Registration Flow

```mermaid
flowchart LR
    subgraph Modules
        M1[customers/ai-tools.ts]
        M2[sales/ai-tools.ts]
        M3[search/ai-tools.ts]
        M4[Other modules...]
    end

    subgraph Registration
        R[registerMcpTool]
        TR[Tool Registry]
    end

    subgraph Runtime
        TL[Tool Loader]
        MCP[MCP Client]
        API[Chat API]
    end

    M1 -->|registerMcpTool| R
    M2 -->|registerMcpTool| R
    M3 -->|registerMcpTool| R
    M4 -->|registerMcpTool| R
    R --> TR

    API -->|loadAllModuleTools| TL
    TL -->|Scans modules| TR
    MCP -->|listToolsWithSchemas| TR
```

## Command Palette State Machine

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Idle: Cmd+K (open)

    Idle --> Routing: Submit query
    Routing --> Chatting: Route complete

    Chatting --> Chatting: Send message
    Chatting --> Confirming: Dangerous tool call
    Confirming --> Executing: Approve
    Confirming --> Chatting: Reject
    Executing --> Chatting: Complete

    Idle --> Closed: Escape
    Chatting --> Idle: Back/Reset
    Chatting --> Closed: Escape

    Closed --> [*]
```

## Component Architecture

```mermaid
graph TD
    subgraph CommandPalette
        CP[CommandPalette.tsx]
        CH[CommandHeader.tsx]
        CI[CommandInput.tsx]
        CF[CommandFooter.tsx]
        DP[DebugPanel.tsx]
    end

    subgraph Pages
        HP[HomePage.tsx]
        TCP[ToolChatPage.tsx]
        TCC[ToolCallConfirmation.tsx]
        MB[MessageBubble.tsx]
    end

    subgraph State
        Provider[CommandPaletteProvider.tsx]
        Hook[useCommandPalette.ts]
        MCPHook[useMcpTools.ts]
    end

    Provider --> CP
    CP --> CH
    CP --> CI
    CP --> CF
    CP --> DP
    CP --> HP
    CP --> TCP
    TCP --> TCC
    TCP --> MB

    Hook --> Provider
    MCPHook --> Hook
```

## Chat Modes

| Mode | Description | Tool Execution | Use Case |
|------|-------------|----------------|----------|
| `agentic` | AI has access to all tools | Server-side, automatic | Main chat interface |
| `default` | Simple text streaming | N/A | Fallback mode |

## Tool Safety Classification

```mermaid
graph LR
    subgraph Safe["Safe (Auto-Execute)"]
        S1[search_*]
        S2[get_*]
        S3[list_*]
        S4[view_*]
        S5[context_*]
    end

    subgraph Dangerous["Dangerous (Require Confirmation)"]
        D1[delete_*]
        D2[remove_*]
        D3[*_delete]
        D4[*_remove]
        D5[reindex_*]
    end

    subgraph Execution
        E1[Auto-execute server-side]
        E2[Show confirmation UI]
    end

    Safe --> E1
    Dangerous --> E2
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/ai/chat` | POST | Streaming chat with AI (supports modes) |
| `/api/ai/tools` | GET | List all available tools |
| `/api/ai/tools/execute` | POST | Execute a specific tool |
| `/api/ai/settings` | GET/POST | AI provider configuration |
| `/api/ai/mcp-servers` | GET/POST | External MCP server list/create |
| `/api/ai/mcp-servers/[id]` | GET/PUT/DELETE | Single MCP server operations |

## Quick Start

### 1. Configure AI Provider

Set one of these environment variables:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### 2. Register a Tool

```typescript
import { registerMcpTool } from '@open-mercato/ai-assistant/tools'
import { z } from 'zod'

registerMcpTool({
  name: 'my_module_action',
  description: 'Description of what this tool does',
  inputSchema: z.object({
    param1: z.string().describe('Description of param1'),
    param2: z.number().optional(),
  }),
  requiredFeatures: ['my_module.action'],
  handler: async (input, ctx) => {
    // Access DI container
    const service = ctx.container.resolve('myService')
    // Execute logic
    return { success: true, data: result }
  }
}, { moduleId: 'my_module' })
```

### 3. Use Command Palette

Press `Cmd+K` (or `Ctrl+K`) to open the command palette and start chatting with the AI.

## Debug Mode

Click the "Debug" button in the command palette footer to see:
- Tool call events
- Tool result events
- SSE stream events
- Connection status

## Directory Structure

```
packages/ai-assistant/
├── src/
│   ├── frontend/
│   │   ├── components/CommandPalette/  # UI components
│   │   ├── hooks/                       # React hooks
│   │   └── types.ts                     # Frontend types
│   │
│   └── modules/ai_assistant/
│       ├── lib/
│       │   ├── mcp-tool-adapter.ts     # Zod schema conversion
│       │   ├── in-process-client.ts    # MCP client
│       │   ├── tool-registry.ts        # Tool registration
│       │   └── chat-config.ts          # Provider config
│       │
│       └── frontend/components/         # Settings page
│
├── AGENTS.md                            # Technical guide for AI agents
└── README.md                            # This file
```

## Technical Notes

### Zod 4 Schema Handling

The module includes a fix for "Date cannot be represented in JSON Schema" errors when using Zod 4 with the Vercel AI SDK. See [AGENTS.md](./AGENTS.md) for details.

### SSE Event Types

```typescript
type SSEEvent =
  | { type: 'text', content: string }
  | { type: 'tool-call', id: string, toolName: string, args: object }
  | { type: 'tool-result', id: string, toolName: string, result: unknown }
  | { type: 'error', error: string }
  | { type: 'done' }
```

## License

Proprietary - Open Mercato
