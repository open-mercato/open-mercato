import { reconcileVendorRecoverySourceClaim } from '../commands/shared'

export const metadata = {
  event: 'warranty_claims.claim.updated',
  persistent: true,
  id: 'warranty_claims:vendor-recovery-reconciliation-undo',
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export default async function handle(payload: unknown, ctx: HandlerContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  if (readString(record, 'claimType') !== 'vendor_recovery') return
  const claimId = readString(record, 'claimId') ?? readString(record, 'id')
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  if (!claimId || !tenantId || !organizationId) return
  await reconcileVendorRecoverySourceClaim(ctx, { claimId, tenantId, organizationId })
}
