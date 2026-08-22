export type StarterPresetId = 'classic' | 'empty' | 'crm' | 'wms' | (string & {})

export type ModuleEntry = { id: string; from: string }

export type StarterPresetModules =
  | { mode: 'replace'; enabled: ModuleEntry[] }
  | { mode: 'patch'; add?: ModuleEntry[]; remove?: string[] }

export type StarterPreset = {
  id: StarterPresetId
  label: string
  description: string
  extends?: StarterPresetId
  modules: StarterPresetModules
  ui: { startPageVariant: 'classic' | 'minimal' | 'crm'; hideDemoLinks: boolean }
  files?: { remove?: string[] }
  constraints?: { rejectWithReadyApps?: boolean }
}

const CORE = '@open-mercato/core'
const EVENTS = '@open-mercato/events'
const AI_ASSISTANT = '@open-mercato/ai-assistant'
const SEARCH = '@open-mercato/search'

const EMPTY_MODULES: ModuleEntry[] = [
  { id: 'auth', from: CORE },
  { id: 'directory', from: CORE },
  { id: 'configs', from: CORE },
  { id: 'entities', from: CORE },
  { id: 'query_index', from: CORE },
  { id: 'api_docs', from: CORE },
  { id: 'audit_logs', from: CORE },
  { id: 'notifications', from: CORE },
  { id: 'dashboards', from: CORE },
  { id: 'events', from: EVENTS },
  // The app shell renders the Cmd+K palette on the `search.global` feature, and a
  // feature whose owning module is not enabled is stripped from every role's grants
  // — superadmin included. `search` therefore has to be part of the baseline, not a
  // CRM extra. It costs nothing to enable: `@open-mercato/search` is already pinned
  // in the template's package.json, and `query_index` above owns the `search_tokens`
  // table the token strategy reads, so the palette works with no Meilisearch and no
  // embedding provider configured.
  { id: 'search', from: SEARCH },
]

export const STARTER_PRESETS: Record<string, StarterPreset> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'Current full starter behavior',
    modules: { mode: 'replace', enabled: [] },
    ui: { startPageVariant: 'classic', hideDemoLinks: false },
    constraints: { rejectWithReadyApps: false },
  },

  empty: {
    id: 'empty',
    label: 'Empty',
    description: 'Minimal builder-ready baseline',
    modules: { mode: 'replace', enabled: EMPTY_MODULES },
    ui: { startPageVariant: 'minimal', hideDemoLinks: true },
    // The example source ships in every preset and stays runtime-disabled through
    // the generated `src/modules.ts`; never delete it here.
    constraints: { rejectWithReadyApps: true },
  },

  crm: {
    id: 'crm',
    label: 'CRM',
    description: 'Empty preset plus CRM capabilities',
    extends: 'empty',
    modules: {
      mode: 'patch',
      add: [
        { id: 'customers', from: CORE },
        { id: 'attachments', from: CORE },
        { id: 'messages', from: CORE },
        { id: 'dictionaries', from: CORE },
        { id: 'feature_toggles', from: CORE },
        { id: 'currencies', from: CORE },
        { id: 'communication_channels', from: CORE },
        { id: 'ai_assistant', from: AI_ASSISTANT },
      ],
    },
    ui: { startPageVariant: 'crm', hideDemoLinks: true },
    constraints: { rejectWithReadyApps: true },
  },

  wms: {
    id: 'wms',
    label: 'WMS',
    description: 'Empty preset plus warehouse and inventory capabilities',
    extends: 'empty',
    modules: {
      mode: 'patch',
      add: [
        { id: 'customers', from: CORE },
        { id: 'dictionaries', from: CORE },
        { id: 'feature_toggles', from: CORE },
        { id: 'catalog', from: CORE },
        { id: 'sales', from: CORE },
        { id: 'wms', from: CORE },
        { id: 'currencies', from: CORE },
      ],
    },
    ui: { startPageVariant: 'minimal', hideDemoLinks: true },
    constraints: { rejectWithReadyApps: true },
  },
}

export const DEFAULT_PRESET_ID = 'classic'
export const VALID_PRESET_IDS = Object.keys(STARTER_PRESETS)
