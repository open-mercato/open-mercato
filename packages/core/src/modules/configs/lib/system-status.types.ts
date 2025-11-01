export type SystemStatusCategoryKey =
  | 'profiling'
  | 'logging'
  | 'caching'
  | 'query_index'
  | 'entities'

export type SystemStatusVariableKind = 'boolean' | 'string'

export type SystemStatusState = 'enabled' | 'disabled' | 'set' | 'unset' | 'unknown'

export type SystemStatusRuntimeMode = 'development' | 'production' | 'test' | 'unknown'

export type SystemStatusItem = {
  key: string
  category: SystemStatusCategoryKey
  kind: SystemStatusVariableKind
  labelKey: string
  descriptionKey: string
  docUrl: string | null
  defaultValue: string | null
  state: SystemStatusState
  value: string | null
  normalizedValue: string | null
}

export type SystemStatusCategory = {
  key: SystemStatusCategoryKey
  labelKey: string
  descriptionKey: string | null
  items: SystemStatusItem[]
}

export type SystemStatusSnapshot = {
  generatedAt: string
  runtimeMode: SystemStatusRuntimeMode
  categories: SystemStatusCategory[]
}
