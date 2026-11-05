/**
 * @deprecated Cmd+K is now reserved for Global Search.
 * Use AI_CHAT_SHORTCUT (Cmd+J) to open the AI Assistant.
 * Kept for backwards compatibility with external consumers.
 */
export const COMMAND_PALETTE_SHORTCUT = {
  key: 'k',
  meta: true, // Cmd on Mac, Ctrl on Windows/Linux
} as const

/**
 * Keyboard shortcut to open the AI Chat/Assistant (Cmd+J on Mac, Ctrl+J on Windows/Linux)
 */
export const AI_CHAT_SHORTCUT = {
  key: 'j',
  meta: true, // Cmd on Mac, Ctrl on Windows/Linux
} as const

export const RECENT_ACTIONS_KEY = 'om:command-palette:recent-actions'
export const MAX_RECENT_ACTIONS = 10

export const NATURAL_LANGUAGE_PATTERNS = [
  /^(what|how|why|when|where|who|can you|please|help|show me|find|search|list|create|update|delete)/i,
  /\?$/,
  /^(i want|i need|i'd like)/i,
] as const

export const MODULE_ICONS: Record<string, string> = {
  customers: 'users',
  catalog: 'package',
  sales: 'shopping-cart',
  search: 'search',
  auth: 'lock',
  dictionaries: 'book',
  directory: 'folder',
  currencies: 'dollar-sign',
  feature_toggles: 'toggle-left',
} as const

export const ACTION_ICONS: Record<string, string> = {
  create: 'plus',
  update: 'edit',
  delete: 'trash',
  search: 'search',
  query: 'search',
  get: 'eye',
  list: 'list',
} as const
