export type StarterPresetId = 'classic' | 'empty' | 'crm' | (string & {})

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
    files: { remove: ['src/modules/example', 'src/modules/example_customers_sync'] },
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
        { id: 'dictionaries', from: CORE },
        { id: 'feature_toggles', from: CORE },
      ],
    },
    ui: { startPageVariant: 'crm', hideDemoLinks: true },
    constraints: { rejectWithReadyApps: true },
  },
}

export const DEFAULT_PRESET_ID = 'classic'
export const VALID_PRESET_IDS = Object.keys(STARTER_PRESETS)
