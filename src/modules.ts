// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth', 'example')
// - from: '@open-mercato/core' | '@open-mercato/example' | '@app' | custom alias/path in future
export type ModuleEntry = { id: string; from?: '@open-mercato/core' | '@open-mercato/example' | '@app' | string }

export const enabledModules: ModuleEntry[] = [
  { id: 'dashboards', from: '@open-mercato/core' },
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'directory', from: '@open-mercato/core' },
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'perspectives', from: '@open-mercato/core' },
  { id: 'entities', from: '@open-mercato/core' },
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'vector_search', from: '@open-mercato/vector-search' },
  { id: 'audit_logs', from: '@open-mercato/core' },
  { id: 'attachments', from: '@open-mercato/core' },
  { id: 'example', from: '@open-mercato/example' },
  { id: 'api_keys', from: '@open-mercato/core' },
  { id: 'dictionaries', from: '@open-mercato/core' }
]
