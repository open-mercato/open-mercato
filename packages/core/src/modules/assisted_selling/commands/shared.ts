import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { applyLiveProposalCountDelta } from '../lib/liveProposalCount'

export const ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND = 'assisted_selling.store_settings'
export const ASSISTED_SELLING_PROPOSAL_RESOURCE_KIND = 'assisted_selling.proposal'
// Step 5.3 (§6.1). `POST /threads/:id/assign` is optimistic-locked on the thread's own
// `updated_at` — "two reps claiming the same conversation get one success and one 409, never
// a silent last-write-wins."
export const ASSISTED_SELLING_THREAD_RESOURCE_KIND = 'assisted_selling.thread'

/**
 * Step 4.4 (S21). "Every feature check goes through `rbacService.userHasAllFeatures` ... a
 * raw `features.includes(...)` comparison is a defect." `organizationId: null` checks
 * possession of the feature only (tenant-scoped) — the REAL "within the caller's own
 * organizations" guarantee (S9) is enforced separately, by scoping the underlying cart/thread
 * READ to the caller's `organizationIds`, exactly as §6.1's own text describes for `POST
 * /threads` ("`cart.carts.view` alone does not check the caller's organization scope").
 */
export async function requireAssistedSellingFeatures(
  ctx: CommandRuntimeContext,
  features: string[],
): Promise<void> {
  const auth = ctx.auth
  if (!auth?.sub || !auth.tenantId) {
    throw forbidden(`[internal] this action requires an authenticated principal holding "${features.join('", "')}"`)
  }
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const granted =
    !!rbac && (await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: null }))
  if (!granted) {
    throw forbidden(`[internal] Missing required feature(s) "${features.join('", "')}"`)
  }
}

/**
 * Validates that `assigneeActorId` is actually staff of `tenantId` — holding the same
 * `assisted_selling.threads.participate` feature every other thread action already
 * requires — before `assignThreadCommand` writes it onto `assigned_actor_id`. Without this,
 * any uuid is accepted: a cross-tenant id both silently "succeeds" (the thread end up
 * pointed at nobody who can act on it) and, combined with the list route's own name
 * resolution, turns `assigned_actor_id` into a user-id oracle for other tenants' staff.
 */
export async function requireAssistedSellingStaffAssignee(
  ctx: CommandRuntimeContext,
  tenantId: string,
  assigneeActorId: string,
): Promise<void> {
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const granted =
    !!rbac &&
    (await rbac.userHasAllFeatures(assigneeActorId, ['assisted_selling.threads.participate'], {
      tenantId,
      organizationId: null,
    }))
  if (!granted) {
    throw new CrudHttpError(400, { error: '[internal] actorId is not a staff member of this tenant', code: 'invalid_assignee' })
  }
}

export type VersionedRecord = {
  id: string
  updatedAt?: Date | string | null
}

export async function enforceAssistedSellingOptimisticLock(
  ctx: CommandRuntimeContext,
  record: VersionedRecord | null | undefined,
  resourceKind = ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
  /** §6.4: `POST /proposals/:id/withdraw`'s body carries `{ updatedAt? }` directly — "or the
   * standard optimistic-lock header." An explicit body value wins over the header (same
   * precedence `enforceCommandOptimisticLockWithGuards` itself documents). */
  expected?: string | Date | null,
): Promise<void> {
  if (!record) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    expected: expected ?? undefined,
    request: ctx.request ?? null,
  })
}
