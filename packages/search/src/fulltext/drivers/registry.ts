import type { FullTextSearchDriver, FullTextSearchDriverConfig, FullTextSearchDriverId } from '../types'

export type FulltextDriverEnvVar = {
  name: string
  required: boolean
  secret?: boolean
  kind?: 'url' | 'string'
  hintKey: string
  hint: string
  defaultValue?: string
}

export type FulltextDriverDescriptor = {
  id: FullTextSearchDriverId
  label: string
  docsUrl?: string
  envVars: FulltextDriverEnvVar[]
}

export type FulltextDriverFactory = {
  id: FullTextSearchDriverId
  describe(): FulltextDriverDescriptor
  isConfigured(env?: NodeJS.ProcessEnv): boolean
  create(config: FullTextSearchDriverConfig): FullTextSearchDriver
}

export type FulltextDriverSelectionSource = 'env' | 'auto' | 'none'
export type FulltextDriverSelectionReason = 'unknown' | 'unconfigured' | 'ambiguous'

export type FulltextDriverSelection = {
  id: FullTextSearchDriverId | null
  source: FulltextDriverSelectionSource
  requested?: string
  reason?: FulltextDriverSelectionReason
}

export const FULLTEXT_DRIVER_ENV = 'FULLTEXT_DRIVER'

const REGISTRY_KEY = Symbol.for('@open-mercato/search/fulltext-driver-registry')

type RegistryGlobals = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, FulltextDriverFactory>
}

function registry(): Map<string, FulltextDriverFactory> {
  const globals = globalThis as RegistryGlobals
  globals[REGISTRY_KEY] ??= new Map<string, FulltextDriverFactory>()
  return globals[REGISTRY_KEY]
}

export function registerFulltextDriverFactory(factory: FulltextDriverFactory): () => void {
  registry().set(factory.id, factory)
  return () => {
    if (registry().get(factory.id) === factory) registry().delete(factory.id)
  }
}

export function getFulltextDriverFactory(id: string): FulltextDriverFactory | null {
  return registry().get(id) ?? null
}

export function listFulltextDriverFactories(): FulltextDriverFactory[] {
  return Array.from(registry().values())
}

export function resolveFulltextDriverSelection(
  env: NodeJS.ProcessEnv = process.env,
  factories: FulltextDriverFactory[] = listFulltextDriverFactories(),
): FulltextDriverSelection {
  const requested = env[FULLTEXT_DRIVER_ENV]?.trim().toLowerCase()
  if (requested) {
    const factory = factories.find((candidate) => candidate.id === requested)
    if (!factory) return { id: null, source: 'env', requested, reason: 'unknown' }
    if (!factory.isConfigured(env)) return { id: null, source: 'env', requested, reason: 'unconfigured' }
    return { id: factory.id, source: 'env', requested }
  }

  const configured = factories.filter((candidate) => candidate.isConfigured(env))
  if (configured.length === 0) return { id: null, source: 'none' }
  if (configured.length === 1) return { id: configured[0].id, source: 'auto' }

  const preferred = configured.find((candidate) => candidate.id === 'meilisearch') ?? configured[0]
  return { id: preferred.id, source: 'auto', reason: 'ambiguous' }
}

export function resolveFulltextDriverId(env: NodeJS.ProcessEnv = process.env): FullTextSearchDriverId | null {
  return resolveFulltextDriverSelection(env).id
}
