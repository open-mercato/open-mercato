type TranslatableFieldsRegistry = Record<string, string[]>

// Use globalThis to survive Turbopack/esbuild module duplication where the same
// file can be loaded as multiple module instances when mixing dynamic and static imports
const GLOBAL_KEY = '__openMercatoTranslatableFields__'

function getGlobal(): TranslatableFieldsRegistry {
  return (globalThis as any)[GLOBAL_KEY] ?? {}
}

function setGlobal(registry: TranslatableFieldsRegistry): void {
  (globalThis as any)[GLOBAL_KEY] = registry
}

export function registerTranslatableFields(fields: TranslatableFieldsRegistry): void {
  setGlobal({ ...getGlobal(), ...fields })
}

export function getTranslatableFields(entityType: string): string[] | undefined {
  return getGlobal()[entityType]
}

export function getTranslatableFieldsRegistry(): TranslatableFieldsRegistry {
  return { ...getGlobal() }
}

export type TranslatableFieldExpansion = {
  key: string
  label?: string
  baseValue?: string
}

export type TranslatableFieldExpander = (record: Record<string, unknown>) => TranslatableFieldExpansion[]

type TranslatableFieldExpanderRegistry = Record<string, TranslatableFieldExpander>

const EXPANDER_GLOBAL_KEY = '__openMercatoTranslatableFieldExpanders__'

type ExpanderGlobalHost = { [EXPANDER_GLOBAL_KEY]?: TranslatableFieldExpanderRegistry }

function getExpanderGlobal(): TranslatableFieldExpanderRegistry {
  return (globalThis as ExpanderGlobalHost)[EXPANDER_GLOBAL_KEY] ?? {}
}

export function registerTranslatableFieldExpander(entityType: string, expander: TranslatableFieldExpander): void {
  const host = globalThis as ExpanderGlobalHost
  host[EXPANDER_GLOBAL_KEY] = { ...getExpanderGlobal(), [entityType]: expander }
}

export function getTranslatableFieldExpander(entityType: string): TranslatableFieldExpander | undefined {
  return getExpanderGlobal()[entityType]
}

type TranslatableEntityListPathRegistry = Record<string, string>

const LIST_PATH_GLOBAL_KEY = '__openMercatoTranslatableEntityListPaths__'

type ListPathGlobalHost = { [LIST_PATH_GLOBAL_KEY]?: TranslatableEntityListPathRegistry }

function getListPathGlobal(): TranslatableEntityListPathRegistry {
  return (globalThis as ListPathGlobalHost)[LIST_PATH_GLOBAL_KEY] ?? {}
}

export function registerTranslatableEntityListPath(entityType: string, listPath: string): void {
  const host = globalThis as ListPathGlobalHost
  host[LIST_PATH_GLOBAL_KEY] = { ...getListPathGlobal(), [entityType]: listPath }
}

export function getTranslatableEntityListPath(entityType: string): string | undefined {
  return getListPathGlobal()[entityType]
}
