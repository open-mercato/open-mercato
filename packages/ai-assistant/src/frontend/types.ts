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

export interface ToolCall {
  id: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: unknown
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: Date
}

export interface CommandPaletteState {
  isOpen: boolean
  mode: CommandPaletteMode
  inputValue: string
  selectedIndex: number
  isLoading: boolean
  isStreaming: boolean
}

export interface CommandPaletteContextValue {
  state: CommandPaletteState
  pageContext: PageContext | null
  selectedEntities: SelectedEntity[]
  tools: ToolInfo[]
  filteredTools: ToolInfo[]
  recentActions: RecentAction[]
  messages: ChatMessage[]
  pendingToolCalls: ToolCall[]

  // Actions
  open: () => void
  close: () => void
  setMode: (mode: CommandPaletteMode) => void
  setInputValue: (value: string) => void
  setSelectedIndex: (index: number) => void
  executeTool: (toolName: string, args?: Record<string, unknown>) => Promise<ToolExecutionResult>
  sendMessage: (content: string) => Promise<void>
  clearMessages: () => void
}

export interface ChatApiRequest {
  messages: ChatMessage[]
  context: PageContext | null
}

export interface ToolsApiResponse {
  tools: ToolInfo[]
}

export interface ToolExecuteRequest {
  toolName: string
  args: Record<string, unknown>
}
