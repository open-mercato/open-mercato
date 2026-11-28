import type { FullTextSearchDriver, FullTextSearchDriverConfig, FullTextSearchDriverId } from '../types'
import { createMeilisearchDriver } from './meilisearch'
import {
  getFulltextDriverFactory,
  registerFulltextDriverFactory,
  resolveFulltextDriverSelection,
  type FulltextDriverFactory,
  type FulltextDriverSelection,
} from './registry'
import { reportSearchError, searchWarn } from '../../lib/debug'

export { createMeilisearchDriver, type MeilisearchDriverOptions } from './meilisearch'
export {
  FULLTEXT_DRIVER_ENV,
  getFulltextDriverFactory,
  listFulltextDriverFactories,
  registerFulltextDriverFactory,
  resolveFulltextDriverId,
  resolveFulltextDriverSelection,
  type FulltextDriverDescriptor,
  type FulltextDriverEnvVar,
  type FulltextDriverFactory,
  type FulltextDriverSelection,
  type FulltextDriverSelectionReason,
  type FulltextDriverSelectionSource,
} from './registry'

export type FulltextDriverFactoryOptions = FullTextSearchDriverConfig & {
  driver?: FullTextSearchDriverId
  meilisearch?: {
    host?: string
    apiKey?: string
    indexPrefix?: string
  }
  algolia?: {
    appId?: string
    apiKey?: string
    indexPrefix?: string
  }
}

export const meilisearchDriverFactory: FulltextDriverFactory = {
  id: 'meilisearch',
  describe: () => ({
    id: 'meilisearch',
    label: 'Meilisearch',
    docsUrl: 'https://www.meilisearch.com/docs/learn/getting_started/quick_start',
    envVars: [
      {
        name: 'MEILISEARCH_HOST',
        required: true,
        kind: 'url',
        hintKey: 'search.settings.fulltext.hints.host',
        hint: 'The URL of your Meilisearch server (e.g., http://localhost:7700)',
      },
      {
        name: 'MEILISEARCH_API_KEY',
        required: true,
        secret: true,
        hintKey: 'search.settings.fulltext.hints.apiKey',
        hint: 'API key for authentication with Meilisearch',
      },
      {
        name: 'MEILISEARCH_INDEX_PREFIX',
        required: false,
        defaultValue: 'om',
        hintKey: 'search.settings.fulltext.hints.indexPrefix',
        hint: 'Prefix for index names to namespace indexes per tenant',
      },
    ],
  }),
  isConfigured: (env = process.env) => Boolean(env.MEILISEARCH_HOST?.trim()),
  create: (config) => createMeilisearchDriver(config),
}

registerFulltextDriverFactory(meilisearchDriverFactory)

const REPORTED_SELECTIONS_KEY = Symbol.for('@open-mercato/search/fulltext-driver-reported-selections')

type ReportGlobals = typeof globalThis & {
  [REPORTED_SELECTIONS_KEY]?: Set<string>
}

function reportSelectionOnce(selection: FulltextDriverSelection): void {
  if (!selection.reason) return
  const globals = globalThis as ReportGlobals
  globals[REPORTED_SELECTIONS_KEY] ??= new Set<string>()
  const key = `${selection.reason}:${selection.requested ?? selection.id ?? ''}`
  if (globals[REPORTED_SELECTIONS_KEY].has(key)) return
  globals[REPORTED_SELECTIONS_KEY].add(key)

  if (selection.reason === 'ambiguous') {
    searchWarn('FulltextDriver', `More than one fulltext driver is configured; using "${selection.id}". Set FULLTEXT_DRIVER to choose explicitly.`, {
      selected: selection.id ?? undefined,
    })
    return
  }
  const message = selection.reason === 'unknown'
    ? `[internal] FULLTEXT_DRIVER="${selection.requested}" does not match any registered fulltext driver`
    : `[internal] FULLTEXT_DRIVER="${selection.requested}" is registered but its environment variables are not set`
  searchWarn('FulltextDriver', message.replace('[internal] ', ''), { requested: selection.requested })
  reportSearchError('FulltextDriver', new Error(message), `search.fulltext_driver_${selection.reason}`, {
    requested: selection.requested,
  })
}

function resolveDriverSelection(options?: FulltextDriverFactoryOptions): FulltextDriverSelection {
  if (options?.driver) {
    const factory = getFulltextDriverFactory(options.driver)
    if (!factory) return { id: null, source: 'env', requested: options.driver, reason: 'unknown' }
    if (!factory.isConfigured(process.env)) return { id: null, source: 'env', requested: options.driver, reason: 'unconfigured' }
    return { id: factory.id, source: 'env', requested: options.driver }
  }
  if (options?.meilisearch?.host) return { id: 'meilisearch', source: 'auto' }
  return resolveFulltextDriverSelection(process.env)
}

export const UNAVAILABLE_FULLTEXT_DRIVER_ID = 'unavailable' as FullTextSearchDriverId

/**
 * Stands in for an explicitly selected driver that cannot be built (unknown id or
 * missing configuration). It is registered so the strategy exists but reports
 * unhealthy: indexing jobs are retried instead of completing without indexing,
 * and Settings → Search shows the reason. Silent absence stays reserved for the
 * intentional case (no driver selected and none configured).
 */
export function createUnavailableFulltextDriver(selection: FulltextDriverSelection): FullTextSearchDriver {
  const reason = selection.reason === 'unknown'
    ? `[internal] FULLTEXT_DRIVER="${selection.requested}" does not match any registered fulltext driver`
    : `[internal] FULLTEXT_DRIVER="${selection.requested}" is registered but its environment variables are not set`
  const unavailable = async (): Promise<never> => {
    throw new Error(reason)
  }
  return {
    id: UNAVAILABLE_FULLTEXT_DRIVER_ID,
    ensureReady: async () => undefined,
    isHealthy: async () => false,
    search: async () => [],
    index: unavailable,
    delete: unavailable,
    bulkIndex: unavailable,
  }
}

export function createFulltextDriver(
  options?: FulltextDriverFactoryOptions
): FullTextSearchDriver | null {
  const selection = resolveDriverSelection(options)
  reportSelectionOnce(selection)
  if (!selection.id) {
    return selection.reason === 'unknown' || selection.reason === 'unconfigured'
      ? createUnavailableFulltextDriver(selection)
      : null
  }

  const config: FullTextSearchDriverConfig = {
    encryptionMapResolver: options?.encryptionMapResolver,
    fieldPolicyResolver: options?.fieldPolicyResolver,
    defaultLimit: options?.defaultLimit,
  }

  if (selection.id === 'meilisearch') {
    return createMeilisearchDriver({
      host: options?.meilisearch?.host ?? process.env.MEILISEARCH_HOST,
      apiKey: options?.meilisearch?.apiKey ?? process.env.MEILISEARCH_API_KEY,
      indexPrefix: options?.meilisearch?.indexPrefix ?? process.env.MEILISEARCH_INDEX_PREFIX,
      ...config,
    })
  }

  const factory = getFulltextDriverFactory(selection.id)
  return factory ? factory.create(config) : null
}
