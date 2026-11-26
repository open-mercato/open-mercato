import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { encryptCustomFieldValue } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { loadScopedCustomFieldDefs } from '@open-mercato/core/modules/entities/lib/scoped-field-defs'
import type { CustomFieldDraft, SeedScope, SqlRow, SqlValue } from './types'

export type CustomFieldDefInfo = {
  kind: string
  encrypted: boolean
}

export type CustomFieldDefIndex = Map<string, Map<string, CustomFieldDefInfo>>

export type CustomFieldValueColumn = 'value_text' | 'value_multiline' | 'value_int' | 'value_float' | 'value_bool'

export type RowEncryptorOptions = {
  service: TenantDataEncryptionService | null
  em?: EntityManager
  scope: SeedScope
  tableColumns?: Map<string, Set<string>> | null
  customFieldDefs: CustomFieldDefIndex
  customFieldRowId: (draft: CustomFieldDraft) => string
  createdAt: Date
}

export type RowEncryptor = {
  encryptRows: (entityId: string, table: string, rows: SqlRow[]) => Promise<SqlRow[]>
  buildCustomFieldRows: (drafts: CustomFieldDraft[]) => Promise<SqlRow[]>
  droppedColumns: () => string[]
}

const toSnakeCase = (value: string): string =>
  value.replace(/([A-Z])/g, '_$1').replace(/__/g, '_').toLowerCase()

export function customFieldColumnForKind(kind: string): CustomFieldValueColumn {
  switch (kind) {
    case 'multiline':
      return 'value_multiline'
    case 'integer':
      return 'value_int'
    case 'float':
      return 'value_float'
    case 'boolean':
      return 'value_bool'
    default:
      return 'value_text'
  }
}

export function customFieldColumnForValue(value: unknown): CustomFieldValueColumn {
  if (typeof value === 'boolean') return 'value_bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'value_int' : 'value_float'
  return 'value_text'
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

function readScope(row: SqlRow): { tenantId: string | null; organizationId: string | null } {
  const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null
  const organizationId = typeof row.organization_id === 'string' ? row.organization_id : null
  return { tenantId, organizationId }
}

function storeCustomFieldValue(column: CustomFieldValueColumn, stored: unknown): SqlValue {
  if (stored === null || stored === undefined) return null
  switch (column) {
    case 'value_int':
    case 'value_float':
      return Number(stored)
    case 'value_bool':
      return Boolean(stored)
    default:
      return String(stored)
  }
}

export function createRowEncryptor(options: RowEncryptorOptions): RowEncryptor {
  const dropped = new Set<string>()
  const dekCache = new Map<string | null, string | null>()

  const normalizeRow = (table: string, payload: Record<string, unknown>): SqlRow => {
    const columns = options.tableColumns?.get(table) ?? null
    const row: SqlRow = {}
    for (const [key, value] of Object.entries(payload)) {
      const column = toSnakeCase(key)
      if (columns && !columns.has(column)) {
        dropped.add(`${table}.${column}`)
        continue
      }
      row[column] = toSqlValue(value)
    }
    return row
  }

  const encryptRows = async (entityId: string, table: string, rows: SqlRow[]): Promise<SqlRow[]> => {
    const service = options.service
    if (!service || !service.isEnabled()) return rows
    const output: SqlRow[] = []
    for (const row of rows) {
      const { tenantId, organizationId } = readScope(row)
      const encrypted = await service.encryptEntityPayload(entityId, { ...row }, tenantId, organizationId, { em: options.em })
      output.push(normalizeRow(table, encrypted))
    }
    return output
  }

  const buildCustomFieldRows = async (drafts: CustomFieldDraft[]): Promise<SqlRow[]> => {
    const { tenantId, organizationId } = options.scope
    const output: SqlRow[] = []
    for (const draft of drafts) {
      const definition = options.customFieldDefs.get(draft.entityId)?.get(draft.fieldKey) ?? null
      const encrypted = definition?.encrypted === true
      const column: CustomFieldValueColumn = encrypted
        ? 'value_text'
        : definition
          ? customFieldColumnForKind(definition.kind)
          : customFieldColumnForValue(draft.value)
      const stored = encrypted
        ? await encryptCustomFieldValue(draft.value, tenantId, options.service, dekCache, {
            entityId: draft.entityId,
            fieldKey: draft.fieldKey,
          })
        : draft.value
      const row: SqlRow = {
        id: options.customFieldRowId(draft),
        entity_id: draft.entityId,
        record_id: draft.recordId,
        organization_id: organizationId,
        tenant_id: tenantId,
        field_key: draft.fieldKey,
        value_text: null,
        value_multiline: null,
        value_int: null,
        value_float: null,
        value_bool: null,
        created_at: options.createdAt,
        deleted_at: null,
      }
      row[column] = storeCustomFieldValue(column, stored)
      output.push(row)
    }
    return output
  }

  return {
    encryptRows,
    buildCustomFieldRows,
    droppedColumns: () => Array.from(dropped).sort(),
  }
}

export async function loadCustomFieldDefIndex(
  em: EntityManager,
  scope: SeedScope,
  entityIds: readonly string[],
): Promise<CustomFieldDefIndex> {
  const index: CustomFieldDefIndex = new Map()
  for (const entityId of entityIds) {
    const definitions = await loadScopedCustomFieldDefs(em, {
      entityId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    const byKey = new Map<string, CustomFieldDefInfo>()
    for (const [key, definition] of definitions) {
      const config = definition.configJson as Record<string, unknown> | null | undefined
      byKey.set(key, { kind: String(definition.kind ?? 'text'), encrypted: Boolean(config?.encrypted) })
    }
    index.set(entityId, byKey)
  }
  return index
}
