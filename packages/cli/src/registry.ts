import type { Module } from '@open-mercato/shared/modules/registry'

// Registration pattern for publishable packages
let _cliModules: Module[] | null = null

export function registerCliModules(modules: Module[]) {
  if (_cliModules !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] CLI modules re-registered (this may occur during HMR)')
  }
  _cliModules = modules
}

export function getCliModules(): Module[] {
  // Return empty array if not registered - allows generate command to work without bootstrap
  return _cliModules ?? []
}

export function hasCliModules(): boolean {
  return _cliModules !== null && _cliModules.length > 0
}
