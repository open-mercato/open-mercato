import type { AdapterModule, SearchAdapter } from '../contract/adapter'
import { notReady } from '../contract/adapter'
import { errorMessage } from '../contract/errors'
import { unavailable } from '../contract/outcomes'
import { CONTRACT_VERSION, MIN_SUPPORTED_CONTRACT_VERSION, isSupportedContractVersion } from '../contract/version'

export type AdapterRegistryEntry = {
  readonly packageName: string
  /** The statically imported module namespace or its default export. */
  readonly module: unknown
}

export type LoadedAdapterModule = {
  readonly packageName: string
  readonly module: AdapterModule<unknown>
}

export type RejectedAdapterModule = {
  readonly packageName: string
  readonly id: string | null
  readonly reason: string
}

export type AdapterModuleRegistry = {
  readonly loaded: readonly LoadedAdapterModule[]
  readonly rejected: readonly RejectedAdapterModule[]
}

const ADAPTER_KINDS = new Set(['serp', 'api', 'model', 'browser'])

/**
 * A stand-in for an adapter that could not be built. Returning one of these
 * instead of throwing is what keeps a broken third-party package from taking the
 * whole tool set down: the scheduler simply reports it as skipped, with the
 * reason, alongside every adapter that did work.
 */
export function createUnavailableAdapter(id: string, reason: string): SearchAdapter {
  return {
    id,
    kind: 'api',
    capabilities: {
      search: false,
      fetch: false,
      snippets: false,
      content: false,
      freshness: false,
      siteFilter: false,
      cost: 'free',
    },
    readiness: () => notReady(reason),
    search: async () => unavailable(reason),
    healthCheck: async () => ({ ok: false, detail: reason }),
  }
}

function describeModule(candidate: unknown): AdapterModule<unknown> | string {
  const unwrapped =
    typeof candidate === 'object' &&
    candidate !== null &&
    'default' in candidate &&
    !('createAdapter' in candidate)
      ? (candidate as { default: unknown }).default
      : candidate

  if (typeof unwrapped !== 'object' || unwrapped === null) {
    return 'module does not export an adapter descriptor'
  }
  const module = unwrapped as Partial<AdapterModule<unknown>>
  if (typeof module.id !== 'string' || module.id.length === 0) return 'adapter descriptor has no id'
  if (typeof module.kind !== 'string' || !ADAPTER_KINDS.has(module.kind)) {
    return `adapter "${module.id}" declares an unknown kind`
  }
  if (typeof module.createAdapter !== 'function') {
    return `adapter "${module.id}" does not expose createAdapter()`
  }
  if (
    typeof module.optionsSchema !== 'object' ||
    module.optionsSchema === null ||
    typeof (module.optionsSchema as { safeParse?: unknown }).safeParse !== 'function'
  ) {
    return `adapter "${module.id}" does not expose a zod optionsSchema`
  }
  if (!isSupportedContractVersion(module.contractVersion)) {
    return `adapter "${module.id}" targets contract version ${String(module.contractVersion)}, this engine speaks ${MIN_SUPPORTED_CONTRACT_VERSION}..${CONTRACT_VERSION}`
  }
  return module as AdapterModule<unknown>
}

/**
 * Validates statically imported adapter modules. Discovery itself is done by the
 * generator so imports stay static — a bundler cannot follow an `import()` with a
 * runtime-computed specifier.
 */
export function resolveAdapterModules(entries: readonly AdapterRegistryEntry[]): AdapterModuleRegistry {
  const loaded: LoadedAdapterModule[] = []
  const rejected: RejectedAdapterModule[] = []
  const seen = new Map<string, string>()

  for (const entry of entries) {
    const described = describeModule(entry.module)
    if (typeof described === 'string') {
      rejected.push({ packageName: entry.packageName, id: null, reason: described })
      continue
    }
    const owner = seen.get(described.id)
    if (owner !== undefined) {
      rejected.push({
        packageName: entry.packageName,
        id: described.id,
        reason: `adapter id "${described.id}" is already provided by ${owner}`,
      })
      continue
    }
    seen.set(described.id, entry.packageName)
    loaded.push({ packageName: entry.packageName, module: described })
  }

  return { loaded, rejected }
}

export type InstantiatedAdapter = {
  readonly id: string
  readonly packageName: string
  readonly adapter: SearchAdapter
  /** Present when the adapter could not be built and a placeholder is standing in. */
  readonly error?: string
}

/** Builds one adapter, converting any options or constructor fault into a placeholder. */
export function instantiateAdapter(
  entry: LoadedAdapterModule,
  rawOptions: unknown,
): InstantiatedAdapter {
  const { module, packageName } = entry
  const parsed = module.optionsSchema.safeParse(rawOptions ?? {})
  if (!parsed.success) {
    const reason = `invalid options for "${module.id}": ${parsed.error.message}`
    return { id: module.id, packageName, adapter: createUnavailableAdapter(module.id, reason), error: reason }
  }
  try {
    const adapter = module.createAdapter(parsed.data)
    if (typeof adapter?.search !== 'function' || typeof adapter?.readiness !== 'function') {
      const reason = `adapter "${module.id}" returned an object that does not implement SearchAdapter`
      return {
        id: module.id,
        packageName,
        adapter: createUnavailableAdapter(module.id, reason),
        error: reason,
      }
    }
    return { id: module.id, packageName, adapter }
  } catch (error) {
    const reason = `adapter "${module.id}" threw while being constructed: ${errorMessage(error)}`
    return { id: module.id, packageName, adapter: createUnavailableAdapter(module.id, reason), error: reason }
  }
}
