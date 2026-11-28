import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import {
  crudFormSectionOutboxJobSchema,
  crudFormSectionOutboxServiceKey,
  deliverCrudFormSectionOutbox,
  type CrudFormSectionOutboxServices,
} from '@open-mercato/shared/lib/crud/form-sections/outbox'
import { getCrudFormSectionOutboxRuntimes } from '../lib/crud-form-outbox'

export const metadata: WorkerMeta = { queue: 'crud-form-section-outbox', id: 'integrations:crud-form-outbox', concurrency: 3 }

export default async function handle(
  job: QueuedJob, context: JobContext & { resolve<T>(name: string): T },
): Promise<void> {
  const identity = crudFormSectionOutboxJobSchema.safeParse(job.payload)
  if (!identity.success) return
  const sink = getCrudFormSectionOutboxRuntimes().get(identity.data.sinkId)
  if (!sink) return
  try {
    await deliverCrudFormSectionOutbox({
      sink, identity: identity.data,
      em: context.resolve<EntityManager>('em'), service: context.resolve<CrudFormSectionOutboxServices>(crudFormSectionOutboxServiceKey),
    })
  } catch {
    throw new Error('[internal] CrudForm outbox worker failed')
  }
}
