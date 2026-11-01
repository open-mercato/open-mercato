import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'

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
