import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { purgeSimulationScope, type SimulationPurgeContext } from '../lib/simulation/purge'

export const metadata = {
  event: 'directory.organization.deleted',
  persistent: true,
  id: 'insights:simulation-organization-deleted',
}

type OrganizationDeletedPayload = {
  id?: unknown
  organizationId?: unknown
  tenantId?: unknown
}

/** An organization's simulation runs disappear with it (S18). Requires both ids; never tenant-wide. */
export default async function handler(payload: OrganizationDeletedPayload, ctx: SimulationPurgeContext): Promise<void> {
  const organizationId = isUuid(payload?.organizationId) ? payload.organizationId : isUuid(payload?.id) ? payload.id : null
  const tenantId = isUuid(payload?.tenantId) ? payload.tenantId : null
  if (!organizationId || !tenantId) return
  await purgeSimulationScope(ctx, { tenantId: tenantId.toLowerCase(), organizationId: organizationId.toLowerCase() })
}
