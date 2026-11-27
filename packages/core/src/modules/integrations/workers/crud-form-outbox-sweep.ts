import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { isRecord } from '@open-mercato/shared/lib/utils'
import {
  crudFormSectionOutboxScopeSchema,
  crudFormSectionOutboxServiceKey,
  type CrudFormSectionOutboxServices,
} from '@open-mercato/shared/lib/crud/form-sections/outbox'
import { sweepCrudFormSectionOutbox } from '../lib/crud-form-outbox'

export const metadata: WorkerMeta = { queue: 'crud-form-section-outbox-sweep', id: 'integrations:crud-form-outbox-sweep', concurrency: 1 }

export default async function handle(
  job: QueuedJob, context: JobContext & { resolve<T>(name: string): T },
): Promise<void> {
  if (!isRecord(job.payload)) return
  const { tenantId, organizationId } = job.payload
  const scope = crudFormSectionOutboxScopeSchema.safeParse({ tenantId, organizationId })
  if (!scope.success) return
  try {
    await sweepCrudFormSectionOutbox(
      context.resolve<EntityManager>('em'), context.resolve<CrudFormSectionOutboxServices>(crudFormSectionOutboxServiceKey), scope.data,
    )
  } catch {
    throw new Error('[internal] CrudForm outbox sweep failed')
  }
}
