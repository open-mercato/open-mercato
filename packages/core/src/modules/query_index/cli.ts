import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { upsertIndexBatch, type AnyRow } from './lib/batch'
import { reindexEntity, DEFAULT_REINDEX_PARTITIONS } from './lib/reindexer'

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

async function purgeEntityIndex(em: EntityManager, entityType: string, tenantId?: string | null): Promise<void> {
  const knex = em.getConnection().getKnex()
  let query = knex('entity_indexes').where('entity_type', entityType)
  if (tenantId !== undefined) {
    query = query.andWhereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
  }
  await query.update({ deleted_at: knex.fn.now(), updated_at: knex.fn.now() })
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
    const batchSize = toPositiveInt(numberOption(args, 'batch', 'chunk', 'size'))
    const partitionsOption = toPositiveInt(numberOption(args, 'partitions', 'partitionCount', 'parallel'))
    const partitionIndexOptionRaw = numberOption(args, 'partition', 'partitionIndex')
    const resetCoverageFlag = flagEnabled(args, 'resetCoverage')
    const skipResetCoverageFlag = flagEnabled(args, 'skipResetCoverage', 'noResetCoverage')
    const skipPurge = flagEnabled(args, 'skipPurge', 'noPurge')

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const partitionIndexOption =
      partitionIndexOptionRaw === undefined ? undefined : toNonNegativeInt(partitionIndexOptionRaw, 0)
    const partitionCount = Math.max(
      1,
      partitionsOption ?? DEFAULT_REINDEX_PARTITIONS,
    )

    if (partitionIndexOption !== undefined && partitionIndexOption >= partitionCount) {
      console.error(`partitionIndex (${partitionIndexOption}) must be < partitionCount (${partitionCount})`)
      return
    }

    const partitionTargets =
      partitionIndexOption !== undefined
        ? [partitionIndexOption]
        : Array.from({ length: partitionCount }, (_, idx) => idx)

    const shouldResetCoverage = (partition: number): boolean => {
      if (resetCoverageFlag) return true
      if (skipResetCoverageFlag) return false
      if (partitionIndexOption !== undefined) return partitionIndexOption === 0
      return partition === partitionTargets[0]
    }

    if (entity) {
      if (!skipPurge) {
        console.log(`Purging existing index rows for ${entity}...`)
        await purgeEntityIndex(em, entity, tenantId)
      }
      console.log(`Reindexing ${entity}${force ? ' (forced)' : ''} in ${partitionTargets.length} partition(s)...`)
      let totalProcessed = 0
      for (const part of partitionTargets) {
        const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
        console.log(`  -> processing${label}`)
        const stats = await reindexEntity(em, {
          entityType: entity,
          tenantId,
          force,
          batchSize,
          emitVectorizeEvents: false,
          partitionCount,
          partitionIndex: part,
          resetCoverage: shouldResetCoverage(part),
        })
        totalProcessed += stats.processed
        console.log(
          `     processed ${stats.processed} row(s)${stats.total ? ` (base ${stats.total})` : ''}`,
        )
      }
      console.log(`Finished ${entity}: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
      return
    }

    const { E: All } = await import('@/generated/entities.ids.generated') as {
      E: Record<string, Record<string, string>>
    }
    const entityIds: string[] = Object.values(All).flatMap((bucket) => Object.values(bucket ?? {}))
    if (!entityIds.length) {
      console.log('No entity definitions registered for query indexing.')
      return
    }
    for (let idx = 0; idx < entityIds.length; idx += 1) {
      const id = entityIds[idx]!
      if (!skipPurge) {
        console.log(`[${idx + 1}/${entityIds.length}] Purging existing index rows for ${id}...`)
        await purgeEntityIndex(em, id, tenantId)
      }
      console.log(
        `[${idx + 1}/${entityIds.length}] Reindexing ${id}${force ? ' (forced)' : ''} in ${partitionTargets.length} partition(s)...`,
      )
      let totalProcessed = 0
      for (const part of partitionTargets) {
        const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
        console.log(`  -> processing${label}`)
        const stats = await reindexEntity(em, {
          entityType: id,
          tenantId,
          force,
          batchSize,
          emitVectorizeEvents: false,
          partitionCount,
          partitionIndex: part,
          resetCoverage: shouldResetCoverage(part),
        })
        totalProcessed += stats.processed
        console.log(
          `     processed ${stats.processed} row(s)${stats.total ? ` (base ${stats.total})` : ''}`,
        )
      }
      console.log(`  -> ${id} complete: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
    }
    console.log(`Finished reindexing ${entityIds.length} entities`)
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
