// Phase-based state for intelligent routing
export type PalettePhase =
  | 'idle'       // Empty, waiting for input
  | 'routing'    // Fast model analyzing intent
  | 'chatting'   // Smart model conversation for tool params
  | 'confirming' // Waiting for user to approve tool call
  | 'executing'  // Tool running

// Page-based navigation for Raycast-style interface (deprecated, use PalettePhase)
export type CommandPalettePage = 'home' | 'tool-chat'

// Connection status for MCP servers
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Legacy mode type (deprecated, kept for compatibility)
export type CommandPaletteMode = 'commands' | 'chat'

export interface PageContext {
  path: string
  module: string | null
  entityType: string | null
  recordId: string | null
  tenantId: string
  organizationId: string | null
}

export interface SelectedEntity {
  entityType: string
  recordId: string
  displayName: string
}

export interface ToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  module?: string
}

export interface ToolExecutionResult {
  success: boolean
  result?: unknown
  error?: string
}

export interface RecentAction {
  id: string
  toolName: string
  displayName: string
  timestamp: number
  args?: Record<string, unknown>
}

// Tool call with confirmation support
export interface ToolCall {
  id: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: unknown
  error?: string
}

// Pending tool call awaiting user confirmation
export interface PendingToolCall {
  id: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'error'
  result?: unknown
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: Date
  // Tool call info if this message contains a tool call
  toolCalls?: PendingToolCall[]
}

// New phase-based state for intelligent routing
export interface CommandPaletteState {
  isOpen: boolean
  phase: PalettePhase
  inputValue: string
  selectedIndex: number
  isLoading: boolean
  isStreaming: boolean
  connectionStatus: ConnectionStatus
  // Legacy fields for backwards compatibility
  page: CommandPalettePage
  mode: CommandPaletteMode
}

export interface CommandPaletteContextValue {
  state: CommandPaletteState
  pageContext: PageContext | null
  selectedEntities: SelectedEntity[]
  tools: ToolInfo[]
  filteredTools: ToolInfo[]
  recentActions: RecentAction[]
  recentTools: ToolInfo[]
  messages: ChatMessage[]
  pendingToolCalls: PendingToolCall[]
  selectedTool: ToolInfo | null
  initialContext: {
    tenantId: string | null
    organizationId: string | null
    userId: string
    isSuperAdmin: boolean
    features: string[]
  } | null
  availableEntities: Array<{ entityId: string; enabled: boolean }> | null

  // Navigation actions
  open: () => void
  close: () => void
  setInputValue: (value: string) => void
  setSelectedIndex: (index: number) => void

  // Intelligent routing - submit natural language query
  handleSubmit: (query: string) => Promise<void>
  reset: () => void

  // Page navigation (legacy, kept for compatibility)
  goToToolChat: (tool: ToolInfo) => void
  goBack: () => void

  // Tool execution
  executeTool: (toolName: string, args?: Record<string, unknown>) => Promise<ToolExecutionResult>
  approveToolCall: (toolCallId: string) => Promise<void>
  rejectToolCall: (toolCallId: string) => void

  // Chat actions
  sendMessage: (content: string) => Promise<void>
  sendAgenticMessage: (content: string) => Promise<void>
  clearMessages: () => void

  // Legacy compatibility
  setMode: (mode: CommandPaletteMode) => void
  setIsOpen: (isOpen: boolean) => void

  // Debug mode
  debugEvents: DebugEvent[]
  showDebug: boolean
  setShowDebug: (show: boolean) => void
  clearDebugEvents: () => void
}

export interface ChatApiRequest {
  messages: ChatMessage[]
  context: PageContext | null
  mode?: 'default' | 'tool-assist' | 'tool-assist-confirm'
  toolName?: string // For tool-specific chat sessions
}

// Routing API response
export interface RouteResult {
  intent: 'tool' | 'general_chat'
  toolName?: string
  confidence: number
  reasoning: string
}

export interface ToolsApiResponse {
  tools: ToolInfo[]
}

export interface ToolExecuteRequest {
  toolName: string
  args: Record<string, unknown>
}

export interface ToolExecuteResponse {
  success: boolean
  result?: unknown
  error?: string
}

// Stream event types for tool-assist-confirm mode
export type StreamEventType = 'text' | 'tool-call' | 'tool-result' | 'error' | 'done'

export interface StreamEvent {
  type: StreamEventType
  content?: string
  toolCall?: {
    id: string
    toolName: string
    args: Record<string, unknown>
  }
  toolResult?: {
    id: string
    result: unknown
  }
  error?: string
}

// Debug event types for debugging the AI chat
export type DebugEventType = 'tool-call' | 'tool-result' | 'text' | 'error' | 'done' | 'message' | 'connection'

export interface DebugEvent {
  id: string
  timestamp: Date
  type: DebugEventType
  data: unknown
}
