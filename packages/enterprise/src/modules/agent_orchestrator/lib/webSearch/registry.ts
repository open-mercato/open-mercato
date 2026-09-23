import type { AwilixContainer } from 'awilix'
import {
  createHttpClient,
  createSearchEngine,
  instantiateAdapter,
  resolveAdapterModules,
  type AdapterRegistryEntry,
  type EngineAdapterEntry,
  type ResultCache,
  type SearchEngine,
  type SearchEngineResult,
  type StepSink,
} from '@open-mercato/web-research'
import { createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import type { WebSearchSettings } from './policy'

/** Adapters that need a host capability the stored config cannot express. */
const MODEL_ADAPTER_ID = 'model-native'

type CacheLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>
}

const MISSING_REGISTRY_REASON =
  'the generated web-research adapter registry is not registered on this container, so no adapter package could be loaded - run `yarn generate`, and if this is an MCP or CLI process, confirm bootstrap loaded web-research-adapters.generated.ts'

function resolveAdapterEntries(container: AwilixContainer): {
  entries: readonly AdapterRegistryEntry[]
  missing: boolean
} {
  try {
    const entries = container.resolve('webResearchAdapterEntries') as AdapterRegistryEntry[] | undefined
    return { entries: entries ?? [], missing: false }
  } catch {
    // An absent registry and an empty one look identical downstream: both give
    // zero adapters and a fast, empty, `degraded` answer that reads like "the
    // web had nothing" rather than "this process is misconfigured". The agent
    // then narrates that guess to the user, so the two cases are kept distinct.
    return { entries: [], missing: true }
  }
}

/**
 * The model adapter needs a live LLM handle, which is not serializable config.
 * Binding it here is the only place OM concepts meet adapter code.
 */
export function hostCapabilitiesFor(adapterId: string, container: AwilixContainer): Record<string, unknown> {
  if (adapterId !== MODEL_ADAPTER_ID) return {}
  return {
    resolveModel: () => createModelFactory(container).resolveModel({ moduleId: 'agent_orchestrator' }),
  }
}

function resolveCache(container: AwilixContainer, tenantId: string | null): ResultCache<SearchEngineResult> | null {
  let cache: CacheLike
  try {
    cache = container.resolve('cache') as CacheLike
  } catch {
    return null
  }
  const tag = `agent_orchestrator:web_search:${tenantId ?? 'global'}`
  return {
    async get(key) {
      try {
        const value = await cache.get(`webresearch:v1:${tenantId ?? 'global'}:${key}`)
        return (value as SearchEngineResult | undefined) ?? null
      } catch {
        return null
      }
    },
    async set(key, value, ttlMs) {
      try {
        await cache.set(`webresearch:v1:${tenantId ?? 'global'}:${key}`, value, {
          ttl: ttlMs,
          tags: [tag],
        })
      } catch {
        // A cache outage must never fail a search.
      }
    },
  }
}

export type BuildEngineOptions = {
  readonly container: AwilixContainer
  readonly settings: WebSearchSettings
  readonly tenantId: string | null
  readonly onStep?: StepSink
  /** Adapters whose hourly call ceiling is spent; they sit this run out. */
  readonly spentBudgets?: ReadonlySet<string>
}

export type BuiltEngine = {
  readonly engine: SearchEngine
  /** Adapters that could not be built, so the health surface can explain why. */
  readonly problems: ReadonlyArray<{ id: string | null; packageName: string; reason: string }>
}

/**
 * Builds a per-request engine: generated adapter registry filtered by policy,
 * each adapter constructed with its tenant options plus any host capability it
 * declared, over one hardened HTTP client.
 */
export function buildWebSearchEngine(options: BuildEngineOptions): BuiltEngine {
  const { container, settings, tenantId } = options
  const { entries, missing } = resolveAdapterEntries(container)
  const registry = resolveAdapterModules(entries)
  const problems: Array<{ id: string | null; packageName: string; reason: string }> = registry.rejected.map(
    (entry) => ({ id: entry.id, packageName: entry.packageName, reason: entry.reason }),
  )
  if (missing) {
    problems.push({ id: null, packageName: '(host)', reason: MISSING_REGISTRY_REASON })
  }

  const spent = options.spentBudgets ?? new Set<string>()
  const policyById = new Map(settings.policy.adapters.map((entry) => [entry.id, entry]))
  const adapters: EngineAdapterEntry[] = []

  for (const loaded of registry.loaded) {
    const id = loaded.module.id
    const configured = policyById.get(id)
    const built = instantiateAdapter(loaded, {
      ...((settings.adapterOptions[id] as Record<string, unknown> | undefined) ?? {}),
      ...hostCapabilitiesFor(id, container),
    })
    if (built.error) {
      problems.push({ id, packageName: loaded.packageName, reason: built.error })
    }
    if (spent.has(id)) {
      // Reported rather than silent: a search that quietly got worse because a
      // ceiling was reached looks exactly like the web having less to say.
      problems.push({
        id,
        packageName: loaded.packageName,
        reason: `hourly call ceiling of ${configured?.maxCallsPerHour} reached for this tenant; the adapter sat this search out`,
      })
    }
    adapters.push({
      adapter: built.adapter,
      enabled: (configured?.enabled ?? false) && !spent.has(id),
      order: configured?.order ?? Number.MAX_SAFE_INTEGER,
      weight: configured?.weight ?? 1,
      ...(configured?.timeoutMs === undefined ? {} : { timeoutMs: configured.timeoutMs }),
    })
  }

  // Deliberately not derived from `adapterTimeoutMs`: that is a whole adapter's
  // budget, while this is one HTTP attempt, and an adapter may make several.
  // Adapters that legitimately need longer pass `timeoutMs` per request.
  const http = createHttpClient({
    maxBytes: settings.guardrails.maxFetchBytes,
    // The only way an operator-hosted service on the container network becomes
    // reachable. Empty unless someone named a host.
    allowPrivateHosts: settings.guardrails.allowPrivateHosts,
  })

  const cache = resolveCache(container, tenantId)

  // `lastResort` deliberately bypasses `enabled`, which would let a spent ceiling
  // be charged again on every short run — the exact case the ceiling exists for.
  const policy =
    settings.policy.lastResort !== null && spent.has(settings.policy.lastResort)
      ? { ...settings.policy, lastResort: null }
      : settings.policy

  return {
    engine: createSearchEngine({
      policy,
      adapters,
      http,
      ...(cache ? { cache } : {}),
      ...(options.onStep ? { onStep: options.onStep } : {}),
    }),
    problems,
  }
}
