import type { EntityManager } from '@mikro-orm/postgresql'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { computeHeaderRollups } from '../lib/stateMachine'

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
  if (claimType !== 'vendor_recovery' || toStatus !== 'resolved') return

  const em = (ctx.resolve('em') as EntityManager).fork()
  const scope = { tenantId, organizationId }
  const recoveryClaim = await findOneWithDecryption(em, WarrantyClaim, { id: claimId, tenantId, organizationId, deletedAt: null }, {}, scope)
  if (!recoveryClaim || recoveryClaim.claimType !== 'vendor_recovery' || recoveryClaim.status !== 'resolved') return
  if (!recoveryClaim.sourceClaimId) return

  const sourceClaim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: recoveryClaim.sourceClaimId, tenantId, organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!sourceClaim) return

  const resolvedChildren = await findWithDecryption(
    em,
    WarrantyClaim,
    { sourceClaimId: sourceClaim.id, claimType: 'vendor_recovery', status: 'resolved', tenantId, organizationId, deletedAt: null },
    {},
    scope,
  )
  let recoveredTotal = 0
  for (const child of resolvedChildren) {
    const childLines = await findWithDecryption(em, WarrantyClaimLine, { claim: child.id, deletedAt: null }, {}, scope)
    recoveredTotal += computeHeaderRollups(childLines).totalApprovedAmount
  }
  sourceClaim.totalRecoveredAmount = String(recoveredTotal)
  sourceClaim.updatedAt = new Date()
  await em.flush()

  await invalidateCrudCache(
    ctx as unknown as Parameters<typeof invalidateCrudCache>[0],
    'warranty_claims.claim',
    { id: sourceClaim.id, organizationId: sourceClaim.organizationId, tenantId: sourceClaim.tenantId },
    tenantId,
    'warranty_claims.vendor_recovery.reconciliation',
  )
}
