import { reconcileVendorRecoverySourceClaim } from '../commands/shared'

export const metadata = {
  event: 'warranty_claims.claim.status_changed',
  persistent: true,
  id: 'warranty_claims:vendor-recovery-reconciliation',
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export default async function handle(payload: unknown, ctx: HandlerContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const claimId = readString(record, 'claimId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId')
  const organizationId = readString(record, 'organizationId')
  const claimType = readString(record, 'claimType')
  const toStatus = readString(record, 'toStatus') ?? readString(record, 'status')
  if (!claimId || !tenantId || !organizationId) return
  if (claimType !== 'vendor_recovery' || (toStatus !== 'resolved' && toStatus !== 'closed')) return

  await reconcileVendorRecoverySourceClaim(ctx, { claimId, tenantId, organizationId })
}
