import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { ensureXrayIngestSchedule } from '../lib/projection/queue'

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
 * Registers the Process X-Ray ingest tick of a new organization (tenant setup only covers
 * the tenant's first organization). Best-effort and idempotent: without the scheduler
 * module it is a no-op.
 */
export default async function handler(payload: OrganizationCreatedPayload, ctx: SubscriberContext): Promise<void> {
  const organizationId = isUuid(payload?.organizationId) ? payload.organizationId : isUuid(payload?.id) ? payload.id : null
  const tenantId = isUuid(payload?.tenantId) ? payload.tenantId : null
  if (!organizationId || !tenantId) return
  await ensureXrayIngestSchedule(
    { resolve: (name) => ctx.resolve(name) },
    { tenantId: tenantId.toLowerCase(), organizationId: organizationId.toLowerCase() },
  )
}
