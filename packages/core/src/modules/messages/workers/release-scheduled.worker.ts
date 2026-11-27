import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MESSAGES_SCHEDULED_RELEASE_QUEUE_NAME, RELEASE_SCHEDULED_COMMAND_ID } from '../lib/scheduledSend'

const logger = createLogger('messages').child({ component: 'scheduled-release' })

export const metadata: WorkerMeta = {
  queue: MESSAGES_SCHEDULED_RELEASE_QUEUE_NAME,
  id: 'messages:release-scheduled',
  concurrency: 1,
}

type ReleaseScheduledPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
  tenantId?: string | null
  organizationId?: string | null
}

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

type ReleaseScheduledResult = { released: string[]; reverted: string[]; returnedToDraft: string[] }

export default async function handle(
  job: QueuedJob<ReleaseScheduledPayload>,
  ctx: JobContext & ContainerLike,
): Promise<void> {
  const raw = job?.payload ?? {}
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  const organizationId = raw.scope?.organizationId ?? raw.organizationId ?? null
  if (!tenantId) {
    logger.warn('skipping tick — payload has no tenantId')
    return
  }
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const containerProxy = { resolve: ctx.resolve.bind(ctx) }
  const { result } = await commandBus.execute<{ tenantId: string; organizationId: string | null }, ReleaseScheduledResult>(
    RELEASE_SCHEDULED_COMMAND_ID,
    {
      input: { tenantId, organizationId },
      ctx: {
        container: containerProxy as never,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
      },
    },
  )
  if (result.released.length > 0 || result.reverted.length > 0 || result.returnedToDraft.length > 0) {
    logger.info('scheduled messages released', {
      tenantId,
      organizationId,
      released: result.released.length,
      reverted: result.reverted.length,
      returnedToDraft: result.returnedToDraft.length,
    })
  }
}
