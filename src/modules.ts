// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth', 'example')
// - from: '@open-mercato/core' | '@open-mercato/example' | '@app' | custom alias/path in future
export type ModuleEntry = { id: string; from?: '@open-mercato/core' | '@open-mercato/example' | '@app' | string }

export const enabledModules: ModuleEntry[] = [
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'directory', from: '@open-mercato/core' },
  { id: 'entities', from: '@open-mercato/core' },
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'example', from: '@open-mercato/example' },
]
