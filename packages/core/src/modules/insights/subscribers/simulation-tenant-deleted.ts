import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { purgeSimulationScope, type SimulationPurgeContext } from '../lib/simulation/purge'

export const metadata = {
  event: 'directory.tenant.deleted',
  persistent: true,
  id: 'insights:simulation-tenant-deleted',
}

type TenantDeletedPayload = {
  id?: unknown
  tenantId?: unknown
}

/** A deleted tenant's simulation runs disappear with it (S18); the tenant id is the record id. */
export default async function handler(payload: TenantDeletedPayload, ctx: SimulationPurgeContext): Promise<void> {
  const tenantId = isUuid(payload?.id) ? payload.id : isUuid(payload?.tenantId) ? payload.tenantId : null
  if (!tenantId) return
  await purgeSimulationScope(ctx, { tenantId: tenantId.toLowerCase(), organizationId: null })
}
