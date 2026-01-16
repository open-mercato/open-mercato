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

---

## OpenCode Integration

The AI Assistant uses **OpenCode** as the AI agent backend. OpenCode is a headless AI coding agent that connects to our MCP server for tool access.

### System Architecture with OpenCode

```mermaid
graph TB
    subgraph "Browser"
        UI[Chat UI]
        Hook[useCommandPalette.ts]
    end

    subgraph "Next.js Server"
        Route["/api/ai/chat"]
        Handlers[opencode-handlers.ts]
        Client[opencode-client.ts]
    end

    subgraph "OpenCode Server :4096"
        OC[OpenCode Agent]
        SSE[SSE /event endpoint]
        Sessions[Session Manager]
        Questions[Question Manager]
    end

    subgraph "MCP Server :4099"
        MCP[MCP Tools]
        Tools[api_discover<br/>api_execute<br/>search_query]
    end

    UI -->|"HTTP POST"| Route
    Route -->|"SSE Stream"| UI
    Route --> Handlers
    Handlers --> Client
    Client -->|"REST API"| OC
    Client <-->|"SSE Subscribe"| SSE
    OC <-->|"MCP Protocol"| MCP
    MCP --> Tools
```

### Complete Message Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as ToolChatPage
    participant Hook as useCommandPalette
    participant API as /api/ai/chat
    participant H as opencode-handlers
    participant C as opencode-client
    participant OC as OpenCode :4096

    Note over U,OC: 1. User Sends Message
    U->>UI: Types "Create company Acme Inc"
    UI->>Hook: onSendMessage()
    Hook->>Hook: setMessages([...prev, userMsg])
    Hook->>Hook: setIsStreaming(true)
    Hook->>API: POST {messages: [...]}

    Note over API,OC: 2. Backend Sets Up SSE
    API->>H: handleOpenCodeMessageStreaming()
    H->>C: subscribeToEvents(callback)
    C->>OC: GET /event (SSE stream)
    H->>C: createSession() or getSession()
    C->>OC: POST /session
    H->>C: sendMessage(sessionId, message)
    C->>OC: POST /session/{id}/message

    Note over OC: 3. OpenCode Processes
    OC->>OC: AI analyzes request
    OC->>OC: Calls MCP tools

    Note over H,UI: 4. Stream Text Response
    OC-->>C: SSE: message.part.updated (text)
    C-->>H: callback({type, properties})
    H-->>API: onEvent({type: 'text', content})
    API-->>Hook: SSE data: {type: 'text'}
    Hook->>Hook: Update streaming message
    Hook-->>UI: Re-render with new text
```

### Question/Answer Flow (Confirmations)

When OpenCode needs user confirmation (e.g., before creating/updating/deleting data):

```mermaid
sequenceDiagram
    participant U as User
    participant UI as ToolChatPage
    participant Hook as useCommandPalette
    participant API as /api/ai/chat
    participant H as opencode-handlers
    participant C as opencode-client
    participant OC as OpenCode

    Note over OC: AI decides to create record
    OC->>OC: Calls AskUserQuestion tool

    Note over OC,UI: 5. Question Event
    OC-->>C: SSE: question.asked
    C-->>H: callback({type: 'question.asked'})
    H->>C: getPendingQuestions()
    C->>OC: GET /question
    OC-->>C: [{id, questions, options}]
    H-->>API: onEvent({type: 'question', question})
    API-->>Hook: SSE data: {type: 'question'}
    Hook->>Hook: setPendingQuestion(question)
    Hook->>Hook: setIsStreaming(false)
    UI->>U: Show question with buttons

    Note over U,OC: 6. User Answers
    U->>UI: Clicks "Yes, create it"
    UI->>Hook: answerQuestion(0)
    Hook->>Hook: shouldStartNewMessage = true
    Hook->>Hook: setIsThinking(true)
    Hook->>Hook: Add "[Confirmed]" message
    Hook->>API: POST {answerQuestion: {questionId, answer}}
    API->>C: answerQuestion(questionId, 0)
    C->>OC: POST /question/{id}/reply
    Note right of C: Body: {"answers": [["Yes, create it"]]}
    API-->>Hook: {success: true}

    Note over OC,UI: 7. Continuation After Answer
    OC->>OC: Continues processing
    OC-->>C: SSE: message.part.updated (text)
    C-->>H: callback({type, properties})
    H-->>API: onEvent({type: 'text', content})
    API-->>Hook: SSE data: {type: 'text'}
    Hook->>Hook: Check shouldStartNewMessage
    Hook->>Hook: Finalize old msg, create NEW msg
    Hook->>Hook: setIsThinking(false)
    UI->>U: Show new response

    Note over OC,UI: 8. Completion
    OC-->>C: SSE: session.status = idle
    H-->>API: onEvent({type: 'done'})
    API-->>Hook: SSE data: {type: 'done'}
    Hook->>Hook: setIsStreaming(false)
```

### OpenCode SSE Events

Events received from OpenCode's `/event` endpoint:

```mermaid
graph LR
    subgraph "Session Events"
        SE1[session.status]
        SE2[session.created]
    end

    subgraph "Message Events"
        ME1[message.updated]
        ME2[message.part.updated]
    end

    subgraph "Question Events"
        QE1[question.asked]
    end

    subgraph "Handlers"
        H1[Update isThinking]
        H2[Emit text/tool-call]
        H3[Emit question]
        H4[Emit done]
    end

    SE1 -->|busy| H1
    SE1 -->|idle| H4
    SE1 -->|waiting| H3
    ME2 -->|text delta| H2
    ME2 -->|tool_use| H2
    QE1 --> H3
```

### Key State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `messages` | `ChatMessage[]` | All chat messages |
| `isStreaming` | `boolean` | API request in progress |
| `isThinking` | `boolean` | OpenCode is processing |
| `pendingQuestion` | `OpenCodeQuestion \| null` | Question awaiting answer |
| `opencodeSessionId` | `string \| null` | Persists conversation |
| `shouldStartNewMessage` | `Ref<boolean>` | Create new msg after answer |
| `answeredQuestionIds` | `Ref<Set<string>>` | Prevent duplicate questions |

### Message State Machine

```mermaid
stateDiagram-v2
    [*] --> Empty: Initial

    Empty --> Streaming: First text event
    Streaming --> Streaming: More text events
    Streaming --> Finalized: Stream ends / Question asked

    Finalized --> NewStreaming: Text after question answer
    NewStreaming --> NewStreaming: More text events
    NewStreaming --> Finalized: Stream ends

    note right of Streaming: id = 'streaming'
    note right of Finalized: id = generateId()
```

### OpenCode API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/event` | GET | SSE event stream |
| `/session` | POST | Create new session |
| `/session/{id}` | GET | Get session |
| `/session/{id}/message` | POST | Send message |
| `/question` | GET | List pending questions |
| `/question/{id}/reply` | POST | Answer question |
| `/question/{id}/reject` | POST | Reject question |
| `/global/health` | GET | Health check |
| `/mcp` | GET | MCP connection status |

### Answer Question Format

```typescript
// POST /question/{requestID}/reply
{
  "answers": [
    ["selected label"]  // Array of selected option labels
  ]
}

// Example - single selection
{ "answers": [["Yes, create it"]] }

// Example - multi-selection (if supported)
{ "answers": [["Option A", "Option B"]] }

// Example - multiple questions
{
  "answers": [
    ["Answer to Q1"],
    ["Answer to Q2"]
  ]
}
```

### Debugging Tips

#### Enable Debug Panel
Click "Debug" in the chat footer to see all SSE events in real-time.

#### Console Log Prefixes
- `[startAgenticChat]` - Initial chat setup
- `[sendAgenticMessage]` - Follow-up messages
- `[answerQuestion]` - Question answering
- `[OpenCode SSE]` - Backend SSE processing
- `[OpenCode Client]` - API client calls
- `[AI Chat]` - API route handling

#### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Loader stays on | `isThinking` not reset | Ensure text events call `setIsThinking(false)` |
| Text appends to old msg | Same content variable | Check `shouldStartNewMessage` flag |
| Question not answered | Wrong endpoint/format | Use `/question/{id}/reply` with `{"answers": [["label"]]}` |
| Duplicate questions | Same question emitted | Track in `answeredQuestionIds` ref |
| Stream never ends | Heartbeat not triggering | Check session status polling |

### Extending the System

#### Adding New SSE Event Handlers

1. Update type in `opencode-handlers.ts`:
```typescript
export type OpenCodeStreamEvent =
  | { type: 'thinking' }
  | { type: 'text'; content: string }
  | { type: 'your-new-event'; data: YourType }  // Add here
  | ...
```

2. Handle in SSE switch statement:
```typescript
switch (type) {
  case 'your.new.event':
    await onEvent({ type: 'your-new-event', data: properties })
    break
}
```

3. Process in frontend hook:
```typescript
if (event.type === 'your-new-event') {
  // Handle in UI
}
```

## License

Proprietary - Open Mercato
