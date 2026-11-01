/**
 * Release 5 Phase 4 (D-R5-27, §6.6, §11). Hourly, per-tenant: CAS every `pending`
 * `CustomerPurchaseApproval` past its OWN already-stored `expires_at` to `expired`,
 * using the SAME conditional-update pattern `customerPurchaseApprovalService#decideApproval`
 * uses (G6) — `UPDATE ... WHERE status = 'pending' AND expires_at <= now()`. A row a
 * concurrent decide already resolved no longer matches `status = 'pending'` and is
 * skipped silently, never double-processed (§11: "safe to re-run").
 *
 * This job never re-resolves the tenant's configured expiry window — that happens once,
 * at `requestApproval` time, and is baked into the row's own `expires_at` column. No
 * `ModuleConfigService` dependency here.
 *
 * @see .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §6.6, §11
 * @see .ai/specs/analysis/ANALYSIS-2026-10-26-customer-groups-release-5.md G6, G21
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerPurchaseApproval } from '../data/entities'
import { emitCustomerGroupsEvent } from '../events'

export type Resolver = { resolve: <T = unknown>(name: string) => T }

const BATCH_SIZE = 200
// Defensive circuit breaker, mirrors `availability/lib/reservationSweep.ts`'s own
// `MAX_PAGES_PER_TICK`: one tick must never loop forever against a pathological backlog.
const MAX_PAGES_PER_TICK = 1000

export type ExpireApprovalsResult = { expiredCount: number }

export async function expirePendingApprovals(
  container: Resolver,
  input: { tenantId: string },
  now: Date = new Date(),
): Promise<ExpireApprovalsResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  let expiredCount = 0

  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const candidates = await em.find(
      CustomerPurchaseApproval,
      { tenantId: input.tenantId, status: 'pending', expiresAt: { $lte: now } },
      { limit: BATCH_SIZE, orderBy: { id: 'asc' } },
    )
    if (candidates.length === 0) break

    for (const candidate of candidates) {
      const affected = await em.nativeUpdate(
        CustomerPurchaseApproval,
        { id: candidate.id, tenantId: input.tenantId, status: 'pending', expiresAt: { $lte: now } },
        { status: 'expired', decidedAt: now, updatedAt: now },
      )
      // A decide or withdraw call won the CAS race between this job's own `find` and
      // its `nativeUpdate` — the row no longer matches `status = 'pending'`. Skipped,
      // never reported as an error (§11/§6.6).
      if (affected === 0) continue

      expiredCount += 1
      await emitCustomerGroupsEvent(
        'customer_groups.approval.expired',
        {
          tenantId: candidate.tenantId,
          organizationId: candidate.organizationId,
          approvalId: candidate.id,
          customerId: candidate.customerId,
          subjectType: candidate.subjectType,
          subjectId: candidate.subjectId,
          amountGross: candidate.amountGross,
          currencyCode: candidate.currencyCode,
          approvalPolicy: candidate.approvalPolicy,
          status: 'expired',
          buyerDecision: candidate.buyerDecision,
          merchantDecision: candidate.merchantDecision,
          requestedBy: { actorType: candidate.requestedByActorType, actorId: candidate.requestedByActorId },
          decidedBy: { actorType: 'system', actorId: null },
        },
        { persistent: true, tenantId: candidate.tenantId, organizationId: candidate.organizationId },
      )
    }

    if (candidates.length < BATCH_SIZE) break
  }

  return { expiredCount }
}
