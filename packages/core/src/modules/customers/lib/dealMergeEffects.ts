import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

export const DEAL_MERGE_EFFECTS_QUEUE = 'customers-deal-merge-effects'

export const DEAL_MERGE_MOVED_VERSION_SQL =
  `select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as moved_version`

export type MovedRecord = { id: string; payload: Record<string, unknown> }

export type DealMergeMovedRecords = {
  activities: MovedRecord[]
  comments: MovedRecord[]
  interactions: MovedRecord[]
}

export type DealMergeEffectsJob = {
  tenantId: string
  organizationId: string
  moved: DealMergeMovedRecords
  movedVersion?: string | null
}

export type DeferredDealMergeEffects = {
  current: DealMergeEffectsJob
  superseded: DealMergeEffectsJob
}

type MovedGroup = keyof DealMergeMovedRecords

type MovedRow = {
  id: string
  entity_id?: string | null
  deal_id?: string | null
  interaction_type?: string | null
  status?: string | null
  source?: string | null
  is_current?: boolean | null
}

type MovedRecordSource = {
  table: string
  columns: string
  softDeleted: boolean
  toPayload: (row: MovedRow) => Record<string, unknown>
}

const MOVED_RECORD_SOURCES: Record<MovedGroup, MovedRecordSource> = {
  interactions: {
    table: 'customer_interactions',
    columns: 'id, entity_id, deal_id, interaction_type, status, source',
    softDeleted: true,
    toPayload: (row) => ({
      entityId: row.entity_id ?? null,
      interactionType: row.interaction_type ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
      dealId: row.deal_id ?? null,
    }),
  },
  activities: {
    table: 'customer_activities',
    columns: 'id, entity_id, deal_id',
    softDeleted: false,
    toPayload: (row) => ({ entityId: row.entity_id ?? null, dealId: row.deal_id ?? null }),
  },
  comments: {
    table: 'customer_comments',
    columns: 'id, entity_id, deal_id',
    softDeleted: true,
    toPayload: (row) => ({ entityId: row.entity_id ?? null, dealId: row.deal_id ?? null }),
  },
}

const MOVED_GROUP_ORDER: MovedGroup[] = ['interactions', 'activities', 'comments']
const DEAL_MERGE_EFFECTS_BATCH_SIZE = 100

let queue: Queue<DealMergeEffectsJob> | undefined

export function hasDealMergeEffectsConsumer(): boolean {
  return process.env.OM_MANAGED_QUEUE_WORKERS?.split(',').includes(DEAL_MERGE_EFFECTS_QUEUE) ?? false
}

export async function enqueueDealMergeEffects(payload: DealMergeEffectsJob): Promise<void> {
  queue ??= createModuleQueue<DealMergeEffectsJob>(DEAL_MERGE_EFFECTS_QUEUE)
  await queue.enqueue(payload)
}

export async function readDealMergeMovedVersion(em: EntityManager): Promise<string | null> {
  const rows = await em.execute<Array<{ moved_version?: unknown }>>(DEAL_MERGE_MOVED_VERSION_SQL, [])
  const version = Array.isArray(rows) ? rows[0]?.moved_version : null
  return typeof version === 'string' && version.length > 0 ? version : null
}

async function readCurrentMovedRows(
  em: EntityManager,
  group: MovedGroup,
  ids: string[],
  job: DealMergeEffectsJob,
): Promise<MovedRow[]> {
  if (ids.length === 0) return []
  const source = MOVED_RECORD_SOURCES[group]
  const version = job.movedVersion ?? null
  const currentPredicate = version ? 'updated_at = ?::timestamptz' : 'true'
  const params: unknown[] = [
    ...(version ? [version] : []),
    job.tenantId,
    job.organizationId,
    JSON.stringify(ids),
  ]
  const rows = await em.execute<MovedRow[]>(
    `select ${source.columns}, (${currentPredicate}) as is_current from ${source.table} where tenant_id = ? and organization_id = ? and id in (select value::uuid from jsonb_array_elements_text(?::jsonb))${source.softDeleted ? ' and deleted_at is null' : ''}`,
    params,
  )
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : []
}

async function lockMovedRows(
  em: EntityManager,
  group: MovedGroup,
  ids: string[],
  job: DealMergeEffectsJob,
): Promise<void> {
  if (ids.length === 0) return
  const source = MOVED_RECORD_SOURCES[group]
  await em.execute(
    `select id from ${source.table} where tenant_id = ? and organization_id = ? and id in (select value::uuid from jsonb_array_elements_text(?::jsonb))${source.softDeleted ? ' and deleted_at is null' : ''} order by id for update`,
    [job.tenantId, job.organizationId, JSON.stringify(ids)],
  )
}

function splitDealMergeEffectsJob(job: DealMergeEffectsJob): DealMergeEffectsJob[] {
  const chunks: DealMergeEffectsJob[] = []
  let moved: DealMergeMovedRecords = { activities: [], comments: [], interactions: [] }
  let size = 0
  for (const group of MOVED_GROUP_ORDER) {
    const seen = new Set<string>()
    for (const record of job.moved[group] ?? []) {
      if (seen.has(record.id)) continue
      seen.add(record.id)
      moved[group].push(record)
      size += 1
      if (size === DEAL_MERGE_EFFECTS_BATCH_SIZE) {
        chunks.push({ ...job, moved })
        moved = { activities: [], comments: [], interactions: [] }
        size = 0
      }
    }
  }
  if (size > 0) chunks.push({ ...job, moved })
  return chunks
}

export async function resolveDeferredDealMergeEffects(
  em: EntityManager,
  job: DealMergeEffectsJob,
): Promise<DeferredDealMergeEffects> {
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const current: DealMergeMovedRecords = { activities: [], comments: [], interactions: [] }
  const superseded: DealMergeMovedRecords = { activities: [], comments: [], interactions: [] }
  for (const group of MOVED_GROUP_ORDER) {
    const ids = [...new Set((job.moved[group] ?? []).map((record) => record.id))]
    const rows = await readCurrentMovedRows(em, group, ids, job)
    const toPayload = MOVED_RECORD_SOURCES[group].toPayload
    for (const row of rows) {
      const record = { id: row.id, payload: toPayload(row) }
      if (row.is_current === true) current[group].push(record)
      else superseded[group].push(record)
    }
  }
  return {
    current: { ...scope, moved: current, movedVersion: job.movedVersion ?? null },
    superseded: { ...scope, moved: superseded, movedVersion: job.movedVersion ?? null },
  }
}

export async function processDeferredDealMergeEffects(
  em: EntityManager,
  dataEngine: DataEngine,
  job: DealMergeEffectsJob,
): Promise<void> {
  for (const chunk of splitDealMergeEffectsJob(job)) {
    let resolved: DeferredDealMergeEffects
    await em.begin()
    try {
      for (const group of MOVED_GROUP_ORDER) {
        await lockMovedRows(em, group, chunk.moved[group].map((record) => record.id), chunk)
      }
      resolved = await resolveDeferredDealMergeEffects(em, chunk)
      markDealMergeEffects(dataEngine, resolved.current)
      await dataEngine.flushOrmEntityChanges({ skipReindex: true, rethrowEventErrors: true })
      await em.commit()
    } catch (error) {
      await em.rollback()
      throw error
    }
    markDealMergeEffects(dataEngine, resolved.current, { publishEvents: false })
    markDealMergeEffects(dataEngine, resolved.superseded, { publishEvents: false })
    await dataEngine.flushOrmEntityChanges()
  }
}

export function markDealMergeEffects(
  dataEngine: DataEngine,
  job: DealMergeEffectsJob,
  options: { publishEvents?: boolean } = {},
): void {
  const { moved, tenantId, organizationId } = job
  const publishEvents = options.publishEvents ?? true
  const groups = [
    { entity: 'activity', records: moved.activities },
    { entity: 'comment', records: moved.comments },
    { entity: 'interaction', records: moved.interactions },
  ]
  for (const { entity, records } of groups) {
    const indexer = { entityType: `customers:customer_${entity}` }
    const events: CrudEventsConfig<Record<string, unknown>> | undefined = publishEvents
      ? {
          module: 'customers',
          entity,
          persistent: true,
          buildPayload: ({ entity: record, identifiers }) => ({ ...record, ...identifiers }),
        }
      : undefined
    for (const record of records) {
      dataEngine.markOrmEntityChange({
        action: 'updated',
        entity: { ...record.payload, id: record.id },
        identifiers: { id: record.id, tenantId, organizationId },
        indexer,
        ...(events ? { events } : {}),
      })
    }
  }
}
