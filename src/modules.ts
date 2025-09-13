// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth', 'example')
// - from: '@mercato-core' | '@mercato-example' | '@app' | custom alias/path in future
export type ModuleEntry = { id: string; from?: '@mercato-core' | '@mercato-example' | '@app' | string }

export const enabledModules: ModuleEntry[] = [
  { id: 'auth', from: '@mercato-core' },
  { id: 'directory', from: '@mercato-core' },
  { id: 'example', from: '@mercato-example' },
]

