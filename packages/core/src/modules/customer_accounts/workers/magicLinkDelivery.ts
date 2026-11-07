import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { sendCustomerMagicLinkEmail } from '@open-mercato/core/modules/customer_accounts/lib/authLinkEmails'
import { MAGIC_LINK_DELIVERY_QUEUE, type AuthLinkDeliveryJobPayload } from '@open-mercato/core/modules/customer_accounts/lib/authLinkQueue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('customer_accounts').child({ component: 'magic-link-delivery' })

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: MAGIC_LINK_DELIVERY_QUEUE,
  id: 'customer_accounts:magic-link-delivery',
  concurrency: 5,
}

export default async function handle(
  job: QueuedJob<AuthLinkDeliveryJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const { email, tenantId } = job.payload
  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService

  const user = await customerUserService.findByEmail(email, tenantId)
  if (!user) return

  const rawToken = await customerTokenService.createMagicLink(user.id, tenantId)

  try {
    await sendCustomerMagicLinkEmail({
      container,
      tenantId,
      organizationId: user.organizationId,
      email: user.email,
      rawToken,
    })
  } catch (error) {
    logger.error('Magic link email failed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'customer_accounts', code: 'customer_accounts.magic_link_email_failed' })
    // Rethrow so the queue retries delivery — the token already minted stays valid
    // for a fresh send attempt or for a manually re-requested magic link.
    throw error
  }

  void import('@open-mercato/core/modules/customer_accounts/events').then(({ emitCustomerAccountsEvent }) =>
    emitCustomerAccountsEvent('customer_accounts.magic_link.requested', {
      userId: user.id,
      tenantId,
      organizationId: user.organizationId,
    })
  ).catch(() => undefined)
}
