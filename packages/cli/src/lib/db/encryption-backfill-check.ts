import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

/**
 * Advisory check run after `db:generate`. Tenant encryption maps are seeded only when a tenant is
 * created, so an `encryption.ts` entry added after tenants exist never reaches them unless a module
 * migration backfills it (`buildEncryptionMapBackfillSql`). The connected database is the evidence:
 * a declared `(entityId, field)` that some existing encryption-enabled scope lacks, and that no
 * migration mentions, is reported. The check only warns; it never fails generation.
 */

export type DeclaredEncryptionMap = {
  moduleId: string
  entityId: string
  fields: string[]
}

export type EncryptionMapRow = {
  tenantId: string | null
  organizationId: string | null
  entityId: string
  fieldsJson: unknown
  isActive: boolean
}

export type EncryptionBackfillGap = {
  moduleId: string
  entityId: string
  field: string
  missingScopes: number
  totalScopes: number
}

export type EncryptionBackfillCheckDeps = {
  loadDeclaredMaps: () => Promise<DeclaredEncryptionMap[]>
  loadMigrationSources: () => string[]
  queryEncryptionMaps: () => Promise<EncryptionMapRow[] | null>
  warn: (message: string) => void
}

export function isEncryptionBackfillCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanWithDefault(env.OM_ENCRYPTION_BACKFILL_CHECK, true)
}

export function readDeclaredEncryptionMaps(moduleId: string, moduleExports: unknown): DeclaredEncryptionMap[] {
  if (!moduleExports || typeof moduleExports !== 'object') return []
  const exportsRecord = moduleExports as Record<string, unknown>
  const maps = exportsRecord.defaultEncryptionMaps ?? exportsRecord.encryptionMaps ?? exportsRecord.default
  if (!Array.isArray(maps)) return []
  const declared: DeclaredEncryptionMap[] = []
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue
    const { entityId, keyScope, fields } = map as Record<string, unknown>
    if (typeof entityId !== 'string' || keyScope === 'system' || !Array.isArray(fields)) continue
    const fieldNames = fields
      .map((rule) => (rule && typeof rule === 'object' ? (rule as Record<string, unknown>).field : null))
      .filter((field): field is string => typeof field === 'string' && field.length > 0)
    if (fieldNames.length) declared.push({ moduleId, entityId, fields: fieldNames })
  }
  return declared
}

function readRuleFields(fieldsJson: unknown): Set<string> {
  const fields = new Set<string>()
  if (!Array.isArray(fieldsJson)) return fields
  for (const rule of fieldsJson) {
    if (rule && typeof rule === 'object' && typeof (rule as Record<string, unknown>).field === 'string') {
      fields.add((rule as Record<string, string>).field)
    }
  }
  return fields
}

function scopeKey(tenantId: string | null, organizationId: string | null): string {
  return `${tenantId ?? ''}|${organizationId ?? ''}`
}

function mentionsLiteral(source: string, value: string): boolean {
  return source.includes(`'${value}'`) || source.includes(`"${value}"`) || source.includes(`\`${value}\``)
}

export function isBackfilledByMigration(migrationSources: readonly string[], entityId: string, field: string): boolean {
  return migrationSources.some(
    (source) =>
      (source.includes('encryption_maps') || source.includes('buildEncryptionMapBackfillSql')) &&
      mentionsLiteral(source, entityId) &&
      mentionsLiteral(source, field),
  )
}

export function findEncryptionBackfillGaps(input: {
  declared: readonly DeclaredEncryptionMap[]
  rows: readonly EncryptionMapRow[]
  migrationSources: readonly string[]
}): EncryptionBackfillGap[] {
  const activeScopes = new Set<string>()
  const fieldsByScopeAndEntity = new Map<string, Set<string>>()
  for (const row of input.rows) {
    const scope = scopeKey(row.tenantId, row.organizationId)
    if (row.isActive) activeScopes.add(scope)
    const key = `${scope}|${row.entityId}`
    const fields = fieldsByScopeAndEntity.get(key) ?? new Set<string>()
    for (const field of readRuleFields(row.fieldsJson)) fields.add(field)
    fieldsByScopeAndEntity.set(key, fields)
  }
  if (activeScopes.size === 0) return []

  const gaps: EncryptionBackfillGap[] = []
  for (const map of input.declared) {
    for (const field of map.fields) {
      let missingScopes = 0
      for (const scope of activeScopes) {
        if (!fieldsByScopeAndEntity.get(`${scope}|${map.entityId}`)?.has(field)) missingScopes += 1
      }
      if (missingScopes === 0) continue
      if (isBackfilledByMigration(input.migrationSources, map.entityId, field)) continue
      gaps.push({ moduleId: map.moduleId, entityId: map.entityId, field, missingScopes, totalScopes: activeScopes.size })
    }
  }
  return gaps
}

export function formatEncryptionBackfillWarning(gaps: readonly EncryptionBackfillGap[]): string {
  const lines = gaps.map(
    (gap) =>
      `   - ${gap.moduleId}: ${gap.entityId}.${gap.field} (missing in ${gap.missingScopes}/${gap.totalScopes} tenant scopes)`,
  )
  return [
    '⚠️  Encryption maps declared in encryption.ts are missing for existing tenants, and no migration backfills them:',
    ...lines,
    '   Tenants that already exist keep writing these fields as plaintext. If the module may already be deployed,',
    '   add a migration that calls buildEncryptionMapBackfillSql from @open-mercato/shared/lib/encryption/migration-backfill.',
    '   Local database only: `yarn mercato entities seed-encryption --tenant <id>`. Silence with OM_ENCRYPTION_BACKFILL_CHECK=off.',
  ].join('\n')
}

export async function checkEncryptionMapBackfills(deps: EncryptionBackfillCheckDeps): Promise<EncryptionBackfillGap[]> {
  try {
    const declared = await deps.loadDeclaredMaps()
    if (!declared.length) return []
    const rows = await deps.queryEncryptionMaps()
    if (!rows?.length) return []
    const gaps = findEncryptionBackfillGaps({ declared, rows, migrationSources: deps.loadMigrationSources() })
    if (gaps.length) deps.warn(formatEncryptionBackfillWarning(gaps))
    return gaps
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.warn(`⚠️  Skipped the encryption map backfill check: ${message}`)
    return []
  }
}
