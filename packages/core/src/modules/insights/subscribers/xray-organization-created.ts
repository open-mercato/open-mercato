import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureXrayCursor } from '../lib/projection/jobs'
import { XrayScopeMismatchError } from '../lib/projection/payloads'
import { ensureXrayIngestSchedule } from '../lib/projection/queue'

const logger = createLogger('insights').child({ component: 'xray-organization-created' })

export const metadata = {
  event: 'directory.organization.created',
  persistent: true,
  id: 'insights:xray-organization-created',
}

type OrganizationCreatedPayload = {
  id?: unknown
  organizationId?: unknown
  tenantId?: unknown
}

type SubscriberContext = {
  resolve: <TService = unknown>(name: string) => TService
}

/**
 * Enrolls a new organization in Process X-Ray (tenant setup only covers the tenant's first
 * organization): creates its ingest cursor, so the system tick ingests it from now on, and makes
 * sure the system tick exists. Idempotent. The organization is verified to belong to the event's
 * tenant first; a mismatch is logged and writes nothing. Other failures are rethrown so the
 * persistent subscriber retries.
 */
export default async function handler(payload: OrganizationCreatedPayload, ctx: SubscriberContext): Promise<void> {
  const organizationId = isUuid(payload?.organizationId) ? payload.organizationId : isUuid(payload?.id) ? payload.id : null
  const tenantId = isUuid(payload?.tenantId) ? payload.tenantId : null
  if (!organizationId || !tenantId) return
  const container = { resolve: (name: string) => ctx.resolve(name) }
  const scope = { tenantId: tenantId.toLowerCase(), organizationId: organizationId.toLowerCase() }
  try {
    await ensureXrayCursor(container, scope)
  } catch (error) {
    if (error instanceof XrayScopeMismatchError) {
      logger.warn(error.message, scope)
      return
    }
    throw error
  }
  await ensureXrayIngestSchedule(container)
}
