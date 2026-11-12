import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'

// §API Contracts (intro paragraph): "every referenced `promotionId`/`codeId` is checked
// for tenant/organization ownership before use (a mismatch answers identically to 'not
// found' — no cross-tenant existence oracle)." The generic `ensureTenantScope`/
// `ensureOrganizationScope` helpers (`@open-mercato/shared/lib/commands/scope`) throw a
// 403 on a scope mismatch, which is the right default for most commands but reveals that
// a record with that id exists under a different tenant/org — exactly the oracle this
// module's own contract text forbids. `GET /api/promotions/[id]` already implements the
// "mismatch == not found" policy directly (see its own comment); this helper gives every
// OTHER promotions command (`promotions.promotion.update`/`.delete`,
// `promotions.rule_tree.reconcile`, `promotions.promotion.reorder`) the same behavior
// without re-deriving the underlying authorization logic (superadmin bypass, wildcard
// orgs, strict-mode env toggle) that `ensureTenantScope`/`ensureOrganizationScope` already
// own — it only translates a resulting 403 into the 404 the spec requires.
export function assertPromotionScopeOrNotFound(
  ctx: CommandRuntimeContext,
  promotion: { tenantId: string; organizationId: string },
): void {
  try {
    ensureTenantScope(ctx, promotion.tenantId)
    ensureOrganizationScope(ctx, promotion.organizationId)
  } catch (err) {
    if (isCrudHttpError(err) && err.status === 403) {
      throw notFound('Promotion not found')
    }
    throw err
  }
}
