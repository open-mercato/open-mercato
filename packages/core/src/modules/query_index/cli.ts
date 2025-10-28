import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
    } else if (i + 1 < rest.length && !rest[i + 1]!.startsWith('--')) {
      args[rawKey] = rest[i + 1]!
      i += 1
    } else {
      args[rawKey] = true
    }
  }
  return args
}

function stringOption(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function numberOption(args: ParsedArgs, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function flagEnabled(args: ParsedArgs, ...keys: string[]): boolean {
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined) continue
    if (raw === true) return true
    if (raw === false) continue
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'true' || normalized === '1' || normalized === '') return true
      if (normalized === 'false' || normalized === '0') return false
      return true
    }
  }
  return false
}

function toPositiveInt(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

function toNonNegativeInt(value: number | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

const DEFAULT_BATCH_SIZE = 200

type AnyRow = Record<string, any> & { id: string | number }

type ScopeOverrides = {
  orgId?: string
  tenantId?: string
}

type CustomFieldRow = {
  record_id: string
  field_key: string
  value_text: string | null
  value_multiline: string | null
  value_int: number | null
  value_float: number | null
  value_bool: boolean | null
  organization_id: string | null
  tenant_id: string | null
}

type RebuildExecutionOptions = {
  knex: Knex
  entityType: string
  tableName: string
  orgOverride?: string
  tenantOverride?: string
  global: boolean
  includeDeleted: boolean
  limit?: number
  offset: number
  recordId?: string
  batchSize: number
  progressLabel?: string
  supportsOrgFilter: boolean
  supportsTenantFilter: boolean
  supportsDeletedFilter: boolean
}

type RebuildResult = {
  processed: number
  matched: number
}

function normalizeId(value: unknown): string {
  return String(value)
}

function normalizeScopedValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function matchesScope(fieldRow: CustomFieldRow, scopeOrg: string | null, scopeTenant: string | null): boolean {
  const cfOrg = normalizeScopedValue(fieldRow.organization_id)
  const cfTenant = normalizeScopedValue(fieldRow.tenant_id)
  const orgMatches = scopeOrg != null ? cfOrg === scopeOrg || cfOrg === null : cfOrg === null
  const tenantMatches = scopeTenant != null ? cfTenant === scopeTenant || cfTenant === null : cfTenant === null
  return orgMatches && tenantMatches
}

function buildDocument(
  baseRow: AnyRow,
  fieldRows: CustomFieldRow[],
  scopeOrg: string | null,
  scopeTenant: string | null,
): Record<string, any> {
  const doc: Record<string, any> = {}
  for (const [key, value] of Object.entries(baseRow)) {
    doc[key] = value
  }
  if (!fieldRows.length) return doc

  const grouped: Record<string, any[]> = {}
  for (const field of fieldRows) {
    if (!matchesScope(field, scopeOrg, scopeTenant)) continue
    const cfKey = `cf:${field.field_key}`
    const value =
      field.value_bool ??
      field.value_int ??
      field.value_float ??
      field.value_text ??
      field.value_multiline ??
      null
    if (!grouped[cfKey]) grouped[cfKey] = []
    grouped[cfKey]!.push(value)
  }
  for (const [key, values] of Object.entries(grouped)) {
    doc[key] = values.length <= 1 ? values[0] : values
  }
  return doc
}

async function upsertIndexBatch(knex: Knex, entityType: string, rows: AnyRow[], scope: ScopeOverrides): Promise<void> {
  if (!rows.length) return
  const recordIds = rows.map((row) => normalizeId(row.id))
  const customFieldRows = await knex<CustomFieldRow>('custom_field_values')
    .select([
      'record_id',
      'field_key',
      'value_text',
      'value_multiline',
      'value_int',
      'value_float',
      'value_bool',
      'organization_id',
      'tenant_id',
    ])
    .where({ entity_id: entityType })
    .whereIn('record_id', recordIds)

  const customFieldMap = new Map<string, CustomFieldRow[]>()
  for (const fieldRow of customFieldRows) {
    const key = normalizeId(fieldRow.record_id)
    const bucket = customFieldMap.get(key)
    if (bucket) bucket.push(fieldRow)
    else customFieldMap.set(key, [fieldRow])
  }

  const basePayloads = rows.map((row) => {
    const recordId = normalizeId(row.id)
    const baseOrg = normalizeScopedValue((row as AnyRow).organization_id)
    const baseTenant = normalizeScopedValue((row as AnyRow).tenant_id)
    const scopeOrg = scope.orgId !== undefined ? scope.orgId : baseOrg
    const scopeTenant = scope.tenantId !== undefined ? scope.tenantId : baseTenant
    const doc = buildDocument(row, customFieldMap.get(recordId) ?? [], scopeOrg, scopeTenant)
    return {
      entity_type: entityType,
      entity_id: recordId,
      organization_id: scopeOrg ?? null,
      tenant_id: scopeTenant ?? null,
      doc,
      index_version: 1,
    }
  })

  const insertRows = basePayloads.map((payload) => ({
    ...payload,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
    deleted_at: null,
  }))

  try {
    await knex('entity_indexes')
      .insert(insertRows)
      .onConflict(['entity_type', 'entity_id', 'organization_id_coalesced'])
      .merge({
        doc: knex.raw('excluded.doc'),
        index_version: knex.raw('excluded.index_version'),
        organization_id: knex.raw('excluded.organization_id'),
        tenant_id: knex.raw('excluded.tenant_id'),
        deleted_at: knex.raw('excluded.deleted_at'),
        updated_at: knex.fn.now(),
      })
    return
  } catch {
    await knex.transaction(async (trx) => {
      const now = trx.fn.now()
      for (const payload of basePayloads) {
        const updated = await trx('entity_indexes')
          .where({
            entity_type: payload.entity_type,
            entity_id: payload.entity_id,
            organization_id: payload.organization_id ?? null,
          })
          .update({
            doc: payload.doc,
            index_version: payload.index_version,
            organization_id: payload.organization_id ?? null,
            tenant_id: payload.tenant_id ?? null,
            updated_at: now,
            deleted_at: null,
          })
        if (updated) continue
        try {
          await trx('entity_indexes').insert({
            ...payload,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          })
        } catch {
          // ignore duplicate insert race; another concurrent worker updated the row
        }
      }
    })
  }
}

async function rebuildEntityIndexes(options: RebuildExecutionOptions): Promise<RebuildResult> {
  const {
    knex,
    entityType,
    tableName,
    orgOverride,
    tenantOverride,
    global,
    includeDeleted,
    limit,
    offset,
    recordId,
    batchSize,
    progressLabel,
    supportsOrgFilter,
    supportsTenantFilter,
    supportsDeletedFilter,
  } = options

  const filters: Record<string, unknown> = {}
  if (!global) {
    if (orgOverride !== undefined && supportsOrgFilter) filters.organization_id = orgOverride
    if (tenantOverride !== undefined && supportsTenantFilter) filters.tenant_id = tenantOverride
  }
  if (!includeDeleted && supportsDeletedFilter) filters.deleted_at = null

  const baseQuery = knex(tableName).where(filters)

  if (recordId) {
    const row = await baseQuery.clone().where({ id: recordId }).first<AnyRow>()
    if (!row) return { processed: 0, matched: 0 }
    const bar = createProgressBar(progressLabel ?? `Rebuilding ${entityType}`, 1)
    await upsertIndexBatch(knex, entityType, [row], { orgId: orgOverride, tenantId: tenantOverride })
    bar.update(1)
    bar.complete()
    return { processed: 1, matched: 1 }
  }

  const countRow = await baseQuery.clone().count<{ count: string }>({ count: '*' }).first()
  const totalRaw = countRow?.count ?? (countRow as any)?.['count(*)']
  const total = totalRaw ? Number(totalRaw) : 0
  const effectiveOffset = Math.max(0, offset)
  const matchedWithoutLimit = Math.max(0, total - effectiveOffset)
  const limitValue = toPositiveInt(limit)
  const intended = limitValue !== undefined ? Math.min(matchedWithoutLimit, limitValue) : matchedWithoutLimit
  if (!Number.isFinite(intended) || intended <= 0) {
    return { processed: 0, matched: 0 }
  }

  const bar = createProgressBar(progressLabel ?? `Rebuilding ${entityType}`, intended)
  let processed = 0
  let cursorOffset = effectiveOffset
  let remaining = limitValue

  while (processed < intended) {
    const chunkLimit = remaining !== undefined ? Math.min(batchSize, remaining) : batchSize
    const chunk = await baseQuery
      .clone()
      .select('*')
      .orderBy('id')
      .limit(chunkLimit)
      .offset(cursorOffset)
    if (!chunk.length) break

    await upsertIndexBatch(knex, entityType, chunk as AnyRow[], {
      orgId: orgOverride,
      tenantId: tenantOverride,
    })

    processed += chunk.length
    cursorOffset += chunk.length
    if (remaining !== undefined) remaining -= chunk.length
    bar.update(processed)
    if (remaining !== undefined && remaining <= 0) break
  }

  if (processed < intended) {
    bar.update(processed)
  }
  bar.complete()
  return { processed, matched: intended }
}

async function getColumnSet(knex: Knex, tableName: string): Promise<Set<string>> {
  try {
    const info = await knex(tableName).columnInfo()
    return new Set(Object.keys(info).map((key) => key.toLowerCase()))
  } catch {
    return new Set<string>()
  }
}

type ScopeDescriptor = {
  global: boolean
  orgId?: string
  tenantId?: string
  includeDeleted: boolean
  supportsOrg: boolean
  supportsTenant: boolean
  supportsDeleted: boolean
}

function describeScope(scope: ScopeDescriptor): string {
  const parts: string[] = []
  if (scope.global) parts.push('global')
  if (!scope.global && scope.orgId && scope.supportsOrg) parts.push(`org=${scope.orgId}`)
  if (!scope.global && scope.tenantId && scope.supportsTenant) parts.push(`tenant=${scope.tenantId}`)
  if (!scope.includeDeleted && scope.supportsDeleted) parts.push('active-only')
  return parts.length ? ` (${parts.join(' ')})` : ''
}

const rebuild: ModuleCli = {
  command: 'rebuild',
  async run(rest) {
    const args = parseArgs(rest)
    const entity = stringOption(args, 'entity', 'e')
    if (!entity) {
      console.error(
        'Usage: mercato query_index rebuild --entity <module:entity> [--record <id>] [--org <id>] [--tenant <id>] [--global] [--withDeleted] [--limit <n>] [--offset <n>]',
      )
      return
    }

    const globalFlag = flagEnabled(args, 'global')
    const includeDeleted = flagEnabled(args, 'withDeleted')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const recordId = stringOption(args, 'record', 'recordId', 'id')
    const limit = toPositiveInt(numberOption(args, 'limit'))
    const offset = toNonNegativeInt(numberOption(args, 'offset'))
    const batchSize = toPositiveInt(numberOption(args, 'batch', 'chunk', 'size')) ?? DEFAULT_BATCH_SIZE

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const knex = em.getConnection().getKnex()
    const tableName = resolveEntityTableName(em, entity)
    const columns = await getColumnSet(knex, tableName)
    const supportsOrg = columns.has('organization_id')
    const supportsTenant = columns.has('tenant_id')
    const supportsDeleted = columns.has('deleted_at')

    if (!globalFlag && orgId && !supportsOrg) {
      console.warn(`[query_index] ${entity} does not expose organization_id, ignoring --org filter`)
    }
    if (!globalFlag && tenantId && !supportsTenant) {
      console.warn(`[query_index] ${entity} does not expose tenant_id, ignoring --tenant filter`)
    }
    if (!includeDeleted && !supportsDeleted) {
      console.warn(`[query_index] ${entity} does not expose deleted_at, cannot skip deleted rows`)
    }

    const result = await rebuildEntityIndexes({
      knex,
      entityType: entity,
      tableName,
      orgOverride: orgId,
      tenantOverride: tenantId,
      global: globalFlag,
      includeDeleted,
      limit,
      offset,
      recordId,
      batchSize,
      progressLabel: recordId ? `Rebuilding ${entity} record ${recordId}` : `Rebuilding ${entity}`,
      supportsOrgFilter: supportsOrg,
      supportsTenantFilter: supportsTenant,
      supportsDeletedFilter: supportsDeleted,
    })

    if (recordId) {
      if (result.processed === 0) {
        console.log(`No matching row found for ${entity} with id ${recordId}`)
      } else {
        console.log(`Rebuilt index for ${entity} record ${recordId}`)
      }
      return
    }

    const scopeLabel = describeScope({
      global: globalFlag,
      orgId,
      tenantId,
      includeDeleted,
      supportsOrg,
      supportsTenant,
      supportsDeleted,
    })

    if (result.matched === 0) {
      console.log(`No rows matched filters for ${entity}${scopeLabel}`)
      return
    }

    console.log(`Rebuilt ${result.processed} row(s) for ${entity}${scopeLabel}`)
  },
}

const rebuildAll: ModuleCli = {
  command: 'rebuild-all',
  async run(rest) {
    const args = parseArgs(rest)
    const globalFlag = flagEnabled(args, 'global')
    const includeDeleted = flagEnabled(args, 'withDeleted')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const limit = toPositiveInt(numberOption(args, 'limit'))
    const offset = toNonNegativeInt(numberOption(args, 'offset'))
    const batchSize = toPositiveInt(numberOption(args, 'batch', 'chunk', 'size')) ?? DEFAULT_BATCH_SIZE
    const recordId = stringOption(args, 'record', 'recordId', 'id')
    if (recordId) {
      console.error('`rebuild-all` does not support --record. Use `mercato query_index rebuild --record <id>` instead.')
      return
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const knex = em.getConnection().getKnex()

    const { E: All } = await import('@/generated/entities.ids.generated') as {
      E: Record<string, Record<string, string>>
    }
    const entityIds: string[] = Object.values(All).flatMap((bucket) => Object.values(bucket ?? {}))
    if (!entityIds.length) {
      console.log('No entity definitions registered for query indexing.')
      return
    }

    let totalProcessed = 0
    for (let idx = 0; idx < entityIds.length; idx += 1) {
      const entity = entityIds[idx]!
      const tableName = resolveEntityTableName(em, entity)
      const columns = await getColumnSet(knex, tableName)
      const supportsOrg = columns.has('organization_id')
      const supportsTenant = columns.has('tenant_id')
      const supportsDeleted = columns.has('deleted_at')

      if (!globalFlag && orgId && !supportsOrg) {
        console.warn(`[query_index] ${entity} does not expose organization_id, ignoring --org filter`)
      }
      if (!globalFlag && tenantId && !supportsTenant) {
        console.warn(`[query_index] ${entity} does not expose tenant_id, ignoring --tenant filter`)
      }
      if (!includeDeleted && !supportsDeleted) {
        console.warn(`[query_index] ${entity} does not expose deleted_at, cannot skip deleted rows`)
      }

      const scopeLabel = describeScope({
        global: globalFlag,
        orgId,
        tenantId,
        includeDeleted,
        supportsOrg,
        supportsTenant,
        supportsDeleted,
      })

      console.log(`[${idx + 1}/${entityIds.length}] Rebuilding ${entity}${scopeLabel}`)
      const result = await rebuildEntityIndexes({
        knex,
        entityType: entity,
        tableName,
        orgOverride: orgId,
        tenantOverride: tenantId,
        global: globalFlag,
        includeDeleted,
        limit,
        offset,
        batchSize,
        supportsOrgFilter: supportsOrg,
        supportsTenantFilter: supportsTenant,
        supportsDeletedFilter: supportsDeleted,
      })
      totalProcessed += result.processed
      if (result.matched === 0) {
        console.log('  -> no rows matched filters')
      } else {
        console.log(`  -> processed ${result.processed} row(s)`)
      }
    }

    console.log(`Finished rebuilding all query indexes (processed ${totalProcessed} row(s))`)
  },
}

const reindex: ModuleCli = {
  command: 'reindex',
  async run(rest) {
    const args = parseArgs(rest)
    const entity = stringOption(args, 'entity', 'e')
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const force = flagEnabled(args, 'force', 'full')

    const container = await createRequestContainer()
    const bus = container.resolve('eventBus') as {
      emitEvent(event: string, payload: any, options?: any): Promise<void>
    }

    if (entity) {
      await bus.emitEvent(
        'query_index.reindex',
        { entityType: entity, tenantId, force },
        { persistent: true },
      )
      console.log(`Scheduled${force ? ' forced full' : ''} reindex for ${entity}`)
      return
    }

    const { E: All } = await import('@/generated/entities.ids.generated') as {
      E: Record<string, Record<string, string>>
    }
    const entityIds: string[] = Object.values(All).flatMap((bucket) => Object.values(bucket ?? {}))
    for (const id of entityIds) {
      await bus.emitEvent(
        'query_index.reindex',
        { entityType: id, tenantId, force },
        { persistent: true },
      )
    }
    console.log(`Scheduled${force ? ' forced full' : ''} reindex for ${entityIds.length} entities`)
  },
}

const purge: ModuleCli = {
  command: 'purge',
  async run(rest) {
    const args = parseArgs(rest)
    const entity = stringOption(args, 'entity', 'e')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')

    const container = await createRequestContainer()
    const bus = container.resolve('eventBus') as {
      emitEvent(event: string, payload: any, options?: any): Promise<void>
    }

    if (entity) {
      await bus.emitEvent(
        'query_index.purge',
        { entityType: entity, organizationId: orgId, tenantId },
        { persistent: true },
      )
      console.log(`Scheduled purge for ${entity}`)
      return
    }

    const { E: All } = await import('@/generated/entities.ids.generated') as {
      E: Record<string, Record<string, string>>
    }
    const entityIds: string[] = Object.values(All).flatMap((bucket) => Object.values(bucket ?? {}))
    for (const id of entityIds) {
      await bus.emitEvent(
        'query_index.purge',
        { entityType: id, organizationId: orgId, tenantId },
        { persistent: true },
      )
    }
    console.log(`Scheduled purge for ${entityIds.length} entities`)
  },
}

export default [rebuild, rebuildAll, reindex, purge]
