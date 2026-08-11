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

function getGlobalModules(): Module[] | null {
  return (globalThis as any)[GLOBAL_KEY] ?? null
}

function setGlobalModules(modules: Module[]): void {
  ;(globalThis as any)[GLOBAL_KEY] = modules
}

export type ModulesRegisteredListener = (modules: Module[]) => void

function getListeners(): Set<ModulesRegisteredListener> {
  const globalScope = globalThis as any
  if (!globalScope[LISTENERS_GLOBAL_KEY]) {
    globalScope[LISTENERS_GLOBAL_KEY] = new Set<ModulesRegisteredListener>()
  }
  return globalScope[LISTENERS_GLOBAL_KEY]
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
 */
export function onModulesRegistered(listener: ModulesRegisteredListener): () => void {
  const listeners = getListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function modulesUnchanged(previous: Module[] | null, next: Module[]): boolean {
  if (previous === null || previous.length !== next.length) return false
  return previous.every((entry, index) => entry === next[index])
}

function notifyModulesRegistered(modules: Module[]): void {
  for (const listener of [...getListeners()]) {
    try {
      listener(modules)
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
  if (!modulesUnchanged(existing, registeredModules)) {
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
