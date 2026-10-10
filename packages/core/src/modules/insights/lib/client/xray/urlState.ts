import { EMPTY_XRAY_FILTERS, type XrayFilterState } from './api'
import { parseWindowParam, serializeWindow, type XrayWindowState } from './window'

export const XRAY_PROCESS_TABS = ['map', 'variants', 'bottlenecks', 'rework', 'conformance', 'breakdown', 'suggestions'] as const

export type XrayProcessTab = (typeof XRAY_PROCESS_TABS)[number]

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAUSE_KIND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/
const LIST_MAX = 50

type ParamReader = { get: (name: string) => string | null }

function readList(params: ParamReader, name: string, pattern: RegExp): string[] {
  const raw = params.get(name)
  if (!raw) return []
  return Array.from(new Set(raw.split(',').map((item) => item.trim()).filter((item) => pattern.test(item)))).slice(0, LIST_MAX)
}

export function isProcessTab(value: unknown): value is XrayProcessTab {
  return typeof value === 'string' && (XRAY_PROCESS_TABS as readonly string[]).includes(value)
}

export type XrayProcessUrlState = {
  tab: XrayProcessTab
  window: XrayWindowState
  filters: XrayFilterState
}

/** The process page state from its URL (`tab`, `w`, `causes`, `roles`, `teams`, `sync`); anything malformed is ignored. */
export function readProcessUrlState(params: ParamReader | null): XrayProcessUrlState {
  if (!params) return { tab: 'map', window: parseWindowParam(null), filters: EMPTY_XRAY_FILTERS }
  const tab = params.get('tab')
  return {
    tab: isProcessTab(tab) ? tab : 'map',
    window: parseWindowParam(params.get('w')),
    filters: {
      causeKinds: readList(params, 'causes', CAUSE_KIND_PATTERN),
      actorRoleIds: readList(params, 'roles', UUID_PATTERN).map((id) => id.toLowerCase()),
      actorTeamIds: readList(params, 'teams', UUID_PATTERN).map((id) => id.toLowerCase()),
      includeSyncRun: params.get('sync') === '1',
    },
  }
}

export function writeProcessUrlState(state: XrayProcessUrlState): string {
  const params = new URLSearchParams()
  if (state.tab !== 'map') params.set('tab', state.tab)
  params.set('w', serializeWindow(state.window))
  if (state.filters.causeKinds.length > 0) params.set('causes', state.filters.causeKinds.join(','))
  if (state.filters.actorRoleIds.length > 0) params.set('roles', state.filters.actorRoleIds.join(','))
  if (state.filters.actorTeamIds.length > 0) params.set('teams', state.filters.actorTeamIds.join(','))
  if (state.filters.includeSyncRun) params.set('sync', '1')
  return params.toString()
}
