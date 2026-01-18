import type { Module } from '@open-mercato/shared/modules/registry'

// Registration pattern for publishable packages
let _modules: Module[] | null = null

export function registerModules(modules: Module[]) {
  if (_modules !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Modules re-registered (this may occur during HMR)')
  }
  _modules = modules
}

export function getModules(): Module[] {
  if (!_modules) {
    throw new Error('[Bootstrap] Modules not registered. Call registerModules() at bootstrap.')
  }
  return _modules
}
