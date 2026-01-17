// Components
export {
  CommandPalette,
  CommandPaletteProvider,
  CommandPaletteWrapper,
  useCommandPaletteContext,
} from './components/CommandPalette'

// Hooks
export {
  useCommandPalette,
  useMcpTools,
  usePageContext,
  useRecentActions,
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
} from './types'

// Utils
export { filterTools, groupToolsByModule, humanizeToolName } from './utils'

// Constants
export {
  COMMAND_PALETTE_SHORTCUT,
  RECENT_ACTIONS_KEY,
  MAX_RECENT_ACTIONS,
} from './constants'
