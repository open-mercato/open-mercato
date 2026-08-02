import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ReferenceTask } from './entities'
import { classifyReferenceTaskDueDate } from '../lib/due-state'

type TaskRecord = Record<string, unknown> & { id: string }
function enrichment(dueAt: Date | string | null | undefined) {
  const dueBucket = classifyReferenceTaskDueDate(dueAt)
  return { _reference_module: { isOverdue: dueBucket === 'overdue', dueBucket } }
}

const taskDueEnricher: ResponseEnricher<TaskRecord, ReturnType<typeof enrichment>> = {
  id: 'reference_module.task-due-state',
  targetEntity: 'reference_module.reference_task',
  features: ['reference_module.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  cacheableOnListHit: false,
  queryEngine: { enabled: true, engines: ['basic', 'hybrid'], applyOn: ['list', 'detail'] },
  fallback: enrichment(null),
  async enrichOne(record, context) {
    const [enriched] = await this.enrichMany!([record], context)
    return enriched
  },
  async enrichMany(records, context) {
    if (records.length === 0) return []
    const em = context.em as EntityManager
    const rows = await findWithDecryption(
      em,
      ReferenceTask,
      {
        id: { $in: records.map((record) => record.id) },
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      { fields: ['id', 'dueAt'] },
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )
    const dueById = new Map(rows.map((row) => [row.id, row.dueAt ?? null]))
    return records.map((record) => ({ ...record, ...enrichment(dueById.get(record.id) ?? null) }))
  },
}

export const enrichers: ResponseEnricher[] = [taskDueEnricher]
