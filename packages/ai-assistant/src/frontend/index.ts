// Components
export {
  CommandPalette,
  CommandPaletteProvider,
  CommandPaletteWrapper,
  useCommandPaletteContext,
} from './components/CommandPalette'

export { AiChatButton } from './components/AiChatButton'
export { AiChatHeaderButton } from './components/AiChatHeaderButton'
export { AiAssistantIntegration } from './components/AiAssistantIntegration'
export { DockableChat } from './components/DockableChat'
export { AiSuggestionBanner } from './components/AiSuggestionBanner'
export { AiSuggestionDiff } from './components/AiSuggestionDiff'

// Hooks
export {
  useCommandPalette,
  useAiFormBridge,
  useMcpTools,
  usePageContext,
  useRecentActions,
  useDockPosition,
  useAiAssistantVisibility,
} from './hooks'

// Types
export type {
  CommandPaletteMode,
  PageContext,
  SelectedEntity,
  ToolInfo,
  ToolExecutionResult,
  RecentAction,
  ToolCall,
  ChatMessage,
  CommandPaletteState,
  CommandPaletteContextValue,
  DockPosition,
  DockState,
  AiFormSuggestion,
  AiFormSuggestionSection,
  AiFormRegistration,
} from './types'

// Utils
export { filterTools, groupToolsByModule, humanizeToolName } from './utils'

// Constants
export {
  COMMAND_PALETTE_SHORTCUT,
  AI_CHAT_SHORTCUT,
  RECENT_ACTIONS_KEY,
  MAX_RECENT_ACTIONS,
} from './constants'
