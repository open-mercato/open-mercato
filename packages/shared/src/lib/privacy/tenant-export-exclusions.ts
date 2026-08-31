const GLOBAL_KEY = '__openMercatoTenantExportExclusions__'
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/

export type TenantExportExclusionReason = 'authentication-or-runtime-secret'

export type TenantExportExclusion = {
  module: string
  table: string
  reason: TenantExportExclusionReason
}

export type TenantExportExclusionInput = {
  module: string
  tables: readonly string[]
  reason?: TenantExportExclusionReason
}

type TenantExportGlobalScope = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, TenantExportExclusion>
}

function store(): Map<string, TenantExportExclusion> {
  const globalScope = globalThis as TenantExportGlobalScope
  globalScope[GLOBAL_KEY] ??= new Map<string, TenantExportExclusion>()
  return globalScope[GLOBAL_KEY]
}

// Tables that hold authentication material or short-lived runtime state are declared by the
// module that owns them, so a tenant exit package never has to know other modules' schemas.
export function registerTenantExportExclusions(input: TenantExportExclusionInput): void {
  const moduleId = input.module.trim()
  if (!moduleId) throw new Error('[internal] Tenant export exclusion module is required')
  if (input.tables.length === 0) {
    throw new Error('[internal] Tenant export exclusion must declare at least one table')
  }
  const reason = input.reason ?? 'authentication-or-runtime-secret'
  for (const table of input.tables) {
    if (!TABLE_NAME_PATTERN.test(table)) {
      throw new Error(`[internal] Invalid tenant export exclusion table name: ${table}`)
    }
    store().set(table, { module: moduleId, table, reason })
  }
}

export function getTenantExportExclusion(table: string): TenantExportExclusion | null {
  return store().get(table) ?? null
}

export function listTenantExportExclusions(): TenantExportExclusion[] {
  return Array.from(store().values()).sort((left, right) => left.table.localeCompare(right.table))
}

export function clearTenantExportExclusions(): void {
  store().clear()
}
