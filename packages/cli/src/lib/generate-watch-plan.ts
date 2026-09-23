export type GenerateWatchCategory =
  | 'api-route' | 'frontend-page' | 'backend-page' | 'commands' | 'di' | 'entities'
  | 'search' | 'events' | 'subscribers' | 'workers' | 'dashboard-widgets'
  | 'injection-widgets' | 'cli' | 'i18n' | 'registry-convention' | 'extension'
  | 'generator-plugin' | 'configuration' | 'unknown'

export type GenerateWatchRecord = {
  key: string
  category: GenerateWatchCategory
  fingerprint: string
  path: string
  extensionId?: string
}

export type GenerateWatchSnapshot = {
  checksum: string
  records: ReadonlyMap<string, GenerateWatchRecord>
  /** Capture validity failures only; unsupported but readable inputs use full-fallback records. */
  fullReasons: readonly string[]
}

export type GenerateWatchChange = {
  kind: 'add' | 'change' | 'delete'
  key: string
  category: GenerateWatchCategory
  path: string
  extensionId?: string
}

export type GenerateWatchGroup =
  | 'entity-ids' | 'registry' | 'entities' | 'di' | 'package-sources'
  | 'web-research-adapters' | 'openapi'

export type GenerateWatchPlan = {
  mode: 'full' | 'incremental' | 'none'
  groups: readonly GenerateWatchGroup[]
  registryOutputs: readonly string[]
  changes: readonly GenerateWatchChange[]
  reasons: readonly string[]
}

const GROUP_ORDER: readonly GenerateWatchGroup[] = [
  'entity-ids', 'registry', 'entities', 'di', 'package-sources', 'web-research-adapters', 'openapi',
]

const REGISTRY_ORDER = [
  'main', 'runtime', 'app', 'bootstrap', 'cli', 'frontend-routes', 'backend-routes',
  'api-routes', 'commands', 'i18n', 'supervisor', 'enabled-ids', 'bootstrap-registrations', 'plugins',
  'registry.search', 'registry.notifications', 'registry.messages', 'registry.ai-tools',
  'registry.ai-agents', 'registry.agent-files', 'registry.events', 'registry.analytics',
  'registry.translatable-fields', 'registry.enrichers', 'registry.interceptors',
  'registry.component-overrides', 'registry.inbox-actions', 'registry.guards',
  'registry.command-interceptors', 'registry.page-middleware', 'registry.dashboard-widgets',
  'registry.injection-widgets', 'registry.workflows',
] as const

const EXTENSION_IDS: readonly string[] = REGISTRY_ORDER.filter((id) => id.startsWith('registry.'))
const MAIN_IMPORT_EXTENSIONS: Readonly<Record<string, true>> = {
  'registry.events': true, 'registry.analytics': true, 'registry.translatable-fields': true, 'registry.workflows': true,
}
const ALL_MODULE_REGISTRIES = ['main', 'runtime', 'app', 'bootstrap', 'cli'] as const

/** Select aggregate consumers, never just the changed module within an aggregate. */
export function planGenerateWatchChanges(
  changes: readonly GenerateWatchChange[],
  fullReasons: readonly string[] = [],
): GenerateWatchPlan {
  const orderedChanges = [...changes].sort((left, right) =>
    left.key.localeCompare(right.key) || left.kind.localeCompare(right.kind),
  )
  const reasons = new Set(fullReasons)
  const groups = new Set<GenerateWatchGroup>()
  const outputs = new Set<string>()
  const registry = (...selected: readonly string[]) => {
    groups.add('registry')
    for (const output of selected) outputs.add(output)
  }

  for (const change of orderedChanges) {
    if (change.key.startsWith('additional-input:')) groups.add('openapi')
    switch (change.category) {
      case 'api-route':
        registry('main', 'runtime', 'api-routes')
        groups.add('openapi')
        break
      case 'frontend-page':
        registry('main', 'runtime', 'app', 'frontend-routes')
        break
      case 'backend-page':
        registry('main', 'runtime', 'app', 'backend-routes')
        break
      case 'entities':
        groups.add('entity-ids')
        groups.add('entities')
        break
      case 'di':
        groups.add('di')
        break
      case 'commands':
        registry('commands')
        break
      case 'search':
        registry('registry.search')
        break
      case 'events':
        registry('main', 'registry.events')
        break
      case 'subscribers':
        registry(...ALL_MODULE_REGISTRIES)
        break
      case 'workers':
        // The existing i18n renderer also emits the worker abandon-hook helper import.
        registry(...ALL_MODULE_REGISTRIES, 'supervisor', 'i18n')
        break
      case 'dashboard-widgets':
        registry('main', 'app', 'bootstrap', 'cli', 'registry.dashboard-widgets')
        break
      case 'injection-widgets':
        registry('registry.injection-widgets')
        break
      case 'cli':
        registry('main', 'cli')
        if (/(?:^|[/\\])scheduler[/\\]cli\.[jt]sx?$/.test(change.path) || change.key.includes(':scheduler:')) registry('supervisor')
        break
      case 'i18n':
        registry('main', 'runtime', 'app', 'cli', 'i18n')
        break
      case 'registry-convention':
        if (change.extensionId === 'supervisor') registry('supervisor')
        else if (/(?:^|[/\\])vector\.[jt]sx?$/.test(change.path)) registry('cli')
        else registry(...ALL_MODULE_REGISTRIES)
        break
      case 'extension': {
        const id = change.extensionId
        if (!id || !EXTENSION_IDS.includes(id)) {
          reasons.add(`Unknown generator extension dependency: ${change.path}`)
          break
        }
        registry(id)
        if (MAIN_IMPORT_EXTENSIONS[id]) registry('main')
        // This convention is also discovered as an ordinary command loader.
        if (id === 'registry.command-interceptors') registry('commands')
        break
      }
      case 'generator-plugin':
        reasons.add(`Generator plugin dependency changed: ${change.path}`)
        break
      case 'configuration':
        reasons.add(`Generator configuration or module authority changed: ${change.path}`)
        break
      case 'unknown':
        reasons.add(`Unclassified generator dependency changed: ${change.path}`)
        break
      default:
        reasons.add(`Unsupported generator dependency: ${change.path}`)
    }
  }

  if (reasons.size > 0) {
    return {
      mode: 'full', groups: [...GROUP_ORDER], registryOutputs: [],
      changes: orderedChanges, reasons: [...reasons].sort(),
    }
  }
  return {
    mode: groups.size > 0 ? 'incremental' : 'none',
    groups: GROUP_ORDER.filter((group) => groups.has(group)),
    registryOutputs: REGISTRY_ORDER.filter((output) => outputs.has(output)),
    changes: orderedChanges,
    reasons: [],
  }
}
