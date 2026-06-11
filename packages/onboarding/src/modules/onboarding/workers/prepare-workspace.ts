import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { runDeferredProvisioning } from '@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning'
import {
  ONBOARDING_PREPARATION_QUEUE,
  ONBOARDING_PREPARATION_WORKER_ID,
  type OnboardingPreparationJobPayload,
} from '@open-mercato/onboarding/modules/onboarding/lib/preparation-queue'

export const metadata: WorkerMeta = {
  queue: ONBOARDING_PREPARATION_QUEUE,
  id: ONBOARDING_PREPARATION_WORKER_ID,
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<OnboardingPreparationJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const service = new OnboardingService(em)
  const request = await service.findById(job.payload.requestId)
  if (!request || request.preparationCompletedAt) return

  await runDeferredProvisioning({
    requestId: job.payload.requestId,
    tenantId: job.payload.tenantId,
    organizationId: job.payload.organizationId,
  })
}
