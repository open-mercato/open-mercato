import type { Module } from '@open-mercato/shared/modules/registry'
import { applyModuleOverridesToModules } from '@open-mercato/shared/modules/overrides'
import { invalidateDictionaryCache } from '../i18n/dictionary-cache'

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

export function registerModules(modules: Module[]) {
  const existing = getGlobalModules()
  if (existing !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Modules re-registered (this may occur during HMR)')
  }
  setGlobalModules(applyModuleOverridesToModules(modules))
  invalidateDictionaryCache()
}

export function getModules(): Module[] {
  const modules = getGlobalModules()
  if (!modules) {
    throw new Error('[Bootstrap] Modules not registered. Call registerModules() at bootstrap.')
  }
  return modules
}
