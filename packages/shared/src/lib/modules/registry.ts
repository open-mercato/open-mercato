import type { Module } from '@open-mercato/shared/modules/registry'
import { applyModuleOverridesToModules } from '@open-mercato/shared/modules/overrides'
import type { Locale } from '../i18n/config'
import { invalidateDictionaryCache, invalidateDictionaryCacheLocales } from '../i18n/dictionary-cache'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'modules-registry' })

// Registration pattern for publishable packages.
// Use globalThis to survive tsx/esbuild module duplication where the same
// registry.ts file can be loaded as multiple module instances when mixing
// dynamic and static imports — for example a standalone integration test
// bootstraps via the source path while a worker handler resolves it through
// node_modules/@open-mercato/shared/dist/. Mirrors the same workaround used
// by `getDiRegistrars()` in `../di/container.ts`.
const GLOBAL_KEY = '__openMercatoModulesRegistry__'
const LISTENERS_GLOBAL_KEY = '__openMercatoModulesRegistryListeners__'
const SNAPSHOT_GLOBAL_KEY = '__openMercatoModulesRegistrySnapshot__'

/**
 * A listener may return a promise; `registerModules()` stays synchronous and
 * never awaits it, so the contract is fire-and-forget on both paths — a
 * synchronous throw and an asynchronous rejection are both observed and logged
 * rather than escaping into the bootstrap frame as an unhandled rejection.
 */
export type ModulesRegisteredListener = (modules: Module[]) => void | PromiseLike<void>

const UNREADABLE_CONTRACT_ENTRY = Symbol('open-mercato.modules.unreadable-contract-entry')

type RegistrationSnapshotEntry = readonly [id: string, contract: ReadonlyArray<readonly [string, unknown]>]
type RegistrationSnapshot = ReadonlyArray<RegistrationSnapshotEntry>

type ModulesRegistryGlobalScope = typeof globalThis & {
  [GLOBAL_KEY]?: Module[] | null
  [LISTENERS_GLOBAL_KEY]?: Set<ModulesRegisteredListener>
  [SNAPSHOT_GLOBAL_KEY]?: RegistrationSnapshot | null
}

function registryGlobals(): ModulesRegistryGlobalScope {
  return globalThis as ModulesRegistryGlobalScope
}

function getGlobalModules(): Module[] | null {
  return registryGlobals()[GLOBAL_KEY] ?? null
}

function setGlobalModules(modules: Module[]): void {
  registryGlobals()[GLOBAL_KEY] = modules
}

function getListeners(): Set<ModulesRegisteredListener> {
  const globalScope = registryGlobals()
  const listeners = globalScope[LISTENERS_GLOBAL_KEY] ?? new Set<ModulesRegisteredListener>()
  globalScope[LISTENERS_GLOBAL_KEY] = listeners
  return listeners
}

/**
 * Subscribe to module-registry (re-)registrations so caches derived from the
 * module list can drop what they built from an incomplete one. Bootstrap can
 * register modules more than once — an i18n-only registration is reconciled
 * with the full module list by `mergeI18nModules()` — and a consumer that
 * memoized its resolution in between would otherwise serve the pre-merge view
 * for the lifetime of the process (issue #5103).
 *
 * Listeners live on `globalThis` for the same module-duplication reason the
 * registry itself does, and they are notified only when the registered set
 * actually changed, so repeated identical bootstraps and HMR re-registrations
 * do not needlessly drop warm caches. Returns an unsubscribe function.
 *
 * Contract (`.ai/specs/2026-08-12-module-registry-registration-listeners.md`):
 * listeners run synchronously at the end of `registerModules()`, after the new
 * module list is readable through `getModules()`; a returned promise is never
 * awaited; neither a throw nor a rejection can break bootstrap; "changed" is
 * decided by the registration snapshot below, which sees module ids, their
 * top-level contract keys and the elements of array-valued ones — a mutation
 * deeper than that is invisible and its owner must invalidate its own cache.
 */
export function onModulesRegistered(listener: ModulesRegisteredListener): () => void {
  const listeners = getListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Freeze what the registered list declares, so a later in-place mutation of a
 * module object cannot retroactively rewrite what the previous registration
 * looked like. Comparing live `Module` references (the obvious cheap check)
 * cannot see an HMR bootstrap that reassigns `dashboardWidgets` on an existing
 * object and re-registers the same array — both sides are then the same
 * reference and the stale widget catalog survives until restart.
 */
function snapshotModules(modules: Module[]): RegistrationSnapshot {
  return modules.map((entry) => {
    const contract = Object.keys(entry)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(entry, key)
        // An accessor is never invoked here: a module may declare a contract as a
        // lazy getter that is expensive, side-effectful, or throws until the rest
        // of bootstrap has run. It is recorded as unreadable instead, which never
        // compares equal — erring toward dropping a warm cache rather than
        // serving a stale one.
        if (!descriptor || !('value' in descriptor)) return [key, UNREADABLE_CONTRACT_ENTRY] as const
        const value = descriptor.value
        return [key, Array.isArray(value) ? [...value] : value] as const
      })
    return [entry.id, contract] as const
  })
}

function contractValuesMatch(previous: unknown, next: unknown): boolean {
  if (previous === UNREADABLE_CONTRACT_ENTRY || next === UNREADABLE_CONTRACT_ENTRY) return false
  if (Array.isArray(previous) && Array.isArray(next)) {
    return previous.length === next.length && previous.every((item, index) => item === next[index])
  }
  return previous === next
}

function snapshotsMatch(previous: RegistrationSnapshot | null, next: RegistrationSnapshot): boolean {
  if (previous === null || previous.length !== next.length) return false
  return previous.every(([id, contract], index) => {
    const [nextId, nextContract] = next[index]
    if (id !== nextId || contract.length !== nextContract.length) return false
    return contract.every(([key, value], contractIndex) => {
      const [nextKey, nextValue] = nextContract[contractIndex]
      return key === nextKey && contractValuesMatch(value, nextValue)
    })
  })
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null | undefined)?.then === 'function'
}

function notifyModulesRegistered(modules: Module[]): void {
  for (const listener of [...getListeners()]) {
    try {
      const result = listener(modules)
      if (isPromiseLike(result)) {
        // The listener contract is fire-and-forget: registerModules() keeps its
        // synchronous signature, so an async subscriber's rejection would land
        // as an unhandled rejection (fatal under Node's default policy) unless
        // it is observed here.
        Promise.resolve(result).catch((err) => {
          logger.error('Module registration listener rejected', { err })
        })
      }
    } catch (err) {
      logger.error('Module registration listener failed', { err })
    }
  }
}

function hasRuntimeContracts(entry: Module): boolean {
  return Object.keys(entry).some((key) => key !== 'id' && key !== 'translations')
}

function isI18nOnlyRegistration(modules: Module[]): boolean {
  return modules.length > 0 && modules.every((entry) => !hasRuntimeContracts(entry))
}

function mergeI18nModules(existing: Module[], incoming: Module[]): Module[] {
  const incomingById = new Map(incoming.map((entry) => [entry.id, entry]))
  const existingIds = new Set(existing.map((entry) => entry.id))
  const merged = existing.map((entry) => {
    const i18nModule = incomingById.get(entry.id)
    if (!i18nModule?.translations) return entry
    return {
      ...entry,
      translations: {
        ...(entry.translations ?? {}),
        ...i18nModule.translations,
      },
    }
  })

  for (const entry of incoming) {
    if (!existingIds.has(entry.id)) merged.push(entry)
  }

  return merged
}

function getTranslationLocales(modules: Module[]): Locale[] {
  const locales = new Set<Locale>()
  for (const entry of modules) {
    for (const locale of Object.keys(entry.translations ?? {})) {
      locales.add(locale as Locale)
    }
  }
  return [...locales]
}

function preserveExistingTranslations(existing: Module[], incoming: Module[]): Module[] {
  const existingById = new Map(existing.map((entry) => [entry.id, entry]))
  return incoming.map((entry) => {
    if (entry.translations) return entry
    const translations = existingById.get(entry.id)?.translations
    return translations ? { ...entry, translations } : entry
  })
}

export function registerModules(modules: Module[]) {
  const existing = getGlobalModules()
  if (existing !== null && process.env.NODE_ENV === 'development') {
    logger.debug('Modules re-registered (this may occur during HMR)')
  }
  const nextModules = applyModuleOverridesToModules(modules)
  const i18nOnlyRegistration = isI18nOnlyRegistration(nextModules)
  const shouldMergeI18nOnly = existing !== null && i18nOnlyRegistration
  const registeredModules = shouldMergeI18nOnly
    ? mergeI18nModules(existing, nextModules)
    : preserveExistingTranslations(existing ?? [], nextModules)
  setGlobalModules(registeredModules)
  if (i18nOnlyRegistration) {
    invalidateDictionaryCacheLocales(getTranslationLocales(nextModules))
  } else {
    invalidateDictionaryCache()
  }
  const globalScope = registryGlobals()
  const previousSnapshot = globalScope[SNAPSHOT_GLOBAL_KEY] ?? null
  const nextSnapshot = snapshotModules(registeredModules)
  globalScope[SNAPSHOT_GLOBAL_KEY] = nextSnapshot
  if (!snapshotsMatch(previousSnapshot, nextSnapshot)) {
    notifyModulesRegistered(registeredModules)
  }
}

export function getModules(): Module[] {
  const modules = getGlobalModules()
  if (!modules) {
    throw new Error('[Bootstrap] Modules not registered. Call registerModules() at bootstrap.')
  }
  return modules
}

/**
 * Non-throwing counterpart of `getModules()` for call sites that have a
 * meaningful degraded behavior when bootstrap has not run — route unit tests
 * exercise a single handler without `registerModules()`, and a hard throw there
 * turns an unrelated assertion into a bootstrap error.
 */
export function tryGetModules(): Module[] | null {
  return getGlobalModules()
}
