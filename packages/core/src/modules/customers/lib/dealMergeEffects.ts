import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

export const DEAL_MERGE_EFFECTS_QUEUE = 'customers-deal-merge-effects'

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
}

let queue: Queue<DealMergeEffectsJob> | undefined

export function hasDealMergeEffectsConsumer(): boolean {
  return process.env.OM_MANAGED_QUEUE_WORKERS?.split(',').includes(DEAL_MERGE_EFFECTS_QUEUE) ?? false
}

export async function enqueueDealMergeEffects(payload: DealMergeEffectsJob): Promise<void> {
  queue ??= createModuleQueue<DealMergeEffectsJob>(DEAL_MERGE_EFFECTS_QUEUE)
  await queue.enqueue(payload)
}

export function markDealMergeEffects(dataEngine: DataEngine, job: DealMergeEffectsJob): void {
  const { moved, tenantId, organizationId } = job
  const groups = [
    { entity: 'activity', records: moved.activities },
    { entity: 'comment', records: moved.comments },
    { entity: 'interaction', records: moved.interactions },
  ]
  for (const { entity, records } of groups) {
    const indexer = { entityType: `customers:customer_${entity}` }
    const events: CrudEventsConfig<Record<string, unknown>> = {
      module: 'customers',
      entity,
      persistent: true,
      buildPayload: ({ entity: record, identifiers }) => ({ ...record, ...identifiers }),
    }
    for (const record of records) {
      dataEngine.markOrmEntityChange({
        action: 'updated',
        entity: { ...record.payload, id: record.id },
        identifiers: { id: record.id, tenantId, organizationId },
        indexer,
        events,
      })
    }
  }
}
