import type {
  ModuleFactSourceKind,
  ModuleFactSourceRef,
  ModuleFactsJsonEntry,
} from './module-facts'

/**
 * The subset of a module's facts needed to resolve the provenance index. Both
 * the in-memory `ModuleFacts` and the emitted `ModuleFactsJsonEntry` satisfy it.
 */
export type FactSourceLookupInput = Pick<
  ModuleFactsJsonEntry,
  | 'apiRoutes'
  | 'cliCommands'
  | 'backendPages'
  | 'frontendPages'
  | 'aiTools'
  | 'aiAgents'
  | 'ownedContracts'
  | 'extensionSurfaces'
  | 'factSources'
>

export type FactSourceLookup = (kind: ModuleFactSourceKind, id: string) => ModuleFactSourceRef | null

function identityKey(left: string, right: string): string {
  return JSON.stringify([left, right])
}

/**
 * Fact sections that do not serialize a source inline: their provenance lives in
 * `factSources` under the mapped kind, so a `factRef` into them resolves with one
 * extra hop. Used by `fact-ref` extension hosts, which reference the fact they
 * expose rather than a declaration of their own.
 */
const SECTION_FACT_KINDS: Record<string, ModuleFactSourceKind> = {
  entities: 'entity',
  events: 'event',
  aclFeatures: 'acl-feature',
  notifications: 'notification',
  searchEntities: 'search',
}

/**
 * Builds the single provenance lookup every consumer uses. `factSources` entries
 * carrying an inline `source` resolve directly; `factRef` entries are followed
 * into the fact section that already serializes the declaration site, so every
 * proven `(kind, id)` resolves deterministically without duplicated payloads.
 */
export function buildFactSourceLookup(facts: FactSourceLookupInput): FactSourceLookup {
  const bySection = new Map<string, ModuleFactSourceRef>()
  const register = (factSection: string, factKey: string, source: ModuleFactSourceRef): void => {
    bySection.set(identityKey(factSection, factKey), source)
  }
  for (const route of facts.apiRoutes ?? []) {
    if (route.sourcePath) register('apiRoutes', route.path, { sourcePath: route.sourcePath })
  }
  for (const command of facts.cliCommands ?? []) {
    register('cliCommands', command.command, { sourcePath: command.sourcePath })
  }
  for (const page of facts.backendPages ?? []) register('backendPages', page.path, { sourcePath: page.sourcePath })
  for (const page of facts.frontendPages ?? []) register('frontendPages', page.path, { sourcePath: page.sourcePath })
  for (const tool of facts.aiTools ?? []) register('aiTools', tool.name, { sourcePath: tool.sourcePath })
  for (const agent of facts.aiAgents ?? []) register('aiAgents', agent.id, { sourcePath: agent.sourcePath })
  for (const [kind, ownedFacts] of Object.entries(facts.ownedContracts ?? {})) {
    for (const fact of ownedFacts ?? []) register(`ownedContracts.${kind}`, fact.id, fact.source)
  }
  for (const contribution of facts.extensionSurfaces?.contributions ?? []) {
    register('extensionSurfaces.contributions', contribution.id, { sourcePath: contribution.source.path })
  }
  const factRefHostTargets = new Map<string, { factSection: string; factKey: string }>()
  for (const host of facts.extensionSurfaces?.hosts ?? []) {
    if (host.source.kind === 'fact-ref') {
      factRefHostTargets.set(host.key, { factSection: host.source.factSection, factKey: host.source.factKey })
      continue
    }
    register('extensionSurfaces.hosts', host.key, { sourcePath: host.source.path })
  }

  const entries = new Map<string, { source?: ModuleFactSourceRef; factSection?: string; factKey?: string }>()
  for (const entry of facts.factSources ?? []) {
    entries.set(identityKey(entry.kind, entry.id), {
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.factRef ? { factSection: entry.factRef.factSection, factKey: entry.factRef.factKey } : {}),
    })
  }

  const resolve = (kind: ModuleFactSourceKind, id: string, depth: number): ModuleFactSourceRef | null => {
    if (depth > 2) return null
    const entry = entries.get(identityKey(kind, id))
    if (!entry) return null
    if (entry.source) return entry.source
    if (entry.factSection === undefined) return null
    const factKey = entry.factKey ?? id
    const direct = bySection.get(identityKey(entry.factSection, factKey))
    if (direct) return direct
    if (entry.factSection === 'extensionSurfaces.hosts') {
      const hostTarget = factRefHostTargets.get(factKey)
      const hostKind = hostTarget ? SECTION_FACT_KINDS[hostTarget.factSection] : undefined
      if (hostTarget && hostKind) return resolve(hostKind, hostTarget.factKey, depth + 1)
      if (hostTarget) return bySection.get(identityKey(hostTarget.factSection, hostTarget.factKey)) ?? null
    }
    const sectionKind = SECTION_FACT_KINDS[entry.factSection]
    return sectionKind ? resolve(sectionKind, factKey, depth + 1) : null
  }

  return (kind, id) => resolve(kind, id, 0)
}
