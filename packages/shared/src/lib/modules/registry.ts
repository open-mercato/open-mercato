import type { Module } from '@open-mercato/shared/modules/registry'
import { applyModuleOverridesToModules } from '@open-mercato/shared/modules/overrides'
import { invalidateDictionaryCache } from '../i18n/dictionary-cache'
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

function getGlobalModules(): Module[] | null {
  return (globalThis as any)[GLOBAL_KEY] ?? null
}

function setGlobalModules(modules: Module[]): void {
  ;(globalThis as any)[GLOBAL_KEY] = modules
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
      translations: i18nModule.translations,
    }
  })

  for (const entry of incoming) {
    if (!existingIds.has(entry.id)) merged.push(entry)
  }

  return merged
}

export function registerModules(modules: Module[]) {
  const existing = getGlobalModules()
  if (existing !== null && process.env.NODE_ENV === 'development') {
    logger.debug('Modules re-registered (this may occur during HMR)')
  }
  const nextModules = applyModuleOverridesToModules(modules)
  const shouldMergeI18nOnly = existing !== null
    && existing.some(hasRuntimeContracts)
    && isI18nOnlyRegistration(nextModules)
  setGlobalModules(shouldMergeI18nOnly ? mergeI18nModules(existing, nextModules) : nextModules)
  invalidateDictionaryCache()
}

export function getModules(): Module[] {
  const modules = getGlobalModules()
  if (!modules) {
    throw new Error('[Bootstrap] Modules not registered. Call registerModules() at bootstrap.')
  }
  return modules
}
