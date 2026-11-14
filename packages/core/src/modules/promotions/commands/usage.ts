import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerUsageInputSchema, revertUsageInputSchema } from '../data/validators'
import { PromotionUsageService, type PromotionsUsageScope } from '../lib/promotion-usage-service'
import type { RegisterUsageInput, ResolvedEffect, RevertUsageInput } from '../lib/types'

// SPEC-055 §Amendment A.2a: `registerUsage`/`revertUsage` are "financially or budget
// consequential writes" and go through the command pattern the same as `Promotion`/`Code`
// CRUD and Step 6.2's `reserveCode`/`releaseCode`/`useCode`. Command ids per §A.2a's own
// list: `promotions.usage.register`, `promotions.usage.revert`.
//
// Each command wraps `lib/promotion-usage-service.ts`'s `PromotionUsageService` — the
// actual row-lock/budget-reread/transaction logic lives there (§Promotion Usage
// Lifecycle); this file only resolves the command-runtime scope/EntityManager and
// dispatches to it, same split as `commands/codes.ts`'s thin command bodies.

// Mirrors `commands/codes.ts`'s `resolveActorScope` — a usage operation's tenant/
// organization scope is always the caller's own actor scope (never a client-supplied
// value), resolved from `ctx.auth`/`ctx.selectedOrganizationId`.
function resolveActorScope(ctx: CommandRuntimeContext): PromotionsUsageScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: '[internal] Tenant and organization scope are required for a promotion usage operation',
    })
  }
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

// `ctx.transactionalEm`, when set, is an already-open (possibly ambient — e.g.
// `checkout`'s own) transaction this command MUST reuse rather than opening its own
// (§Promotion Usage Lifecycle's row-lock correction depends on this: locking inside the
// SAME transaction as the caller is what makes the lock effective whether the call is
// top-level or nested). Otherwise fork the request `em`, same precedent as every other
// command in this module.
function resolveCommandEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
}

function resolveUsageService(ctx: CommandRuntimeContext): PromotionUsageService {
  return ctx.container.resolve('promotionUsageService') as PromotionUsageService
}

const registerUsageCommand: CommandHandler<unknown, { ok: true; budgetExceeded: string[] }> = {
  id: 'promotions.usage.register',
  async execute(rawInput, ctx) {
    const parsed = registerUsageInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    const input: RegisterUsageInput = {
      orderId: parsed.orderId,
      orderType: parsed.orderType,
      customerId: parsed.customerId,
      currency: parsed.currency,
      appliedPromotions: parsed.appliedPromotions.map((applied) => ({
        promotionId: applied.promotionId,
        promotionName: applied.promotionName,
        // Effects arrive already-typed from the in-process caller (`evaluate()`'s own
        // `ResolvedEffect[]` output) — no HTTP route exists yet (Step 6.7) to make this a
        // genuine untrusted-wire boundary. `registerUsageInputSchema` validates only the
        // structural shape (plain objects, per the jsonb-snapshot convention this
        // module's `effectsSnapshot`/`effects` fields already use); this cast restores
        // the real discriminated-union type the service needs for the `ADD_FREE_ITEM`
        // budget-exclusion rule.
        effects: applied.effects as unknown as ResolvedEffect[],
      })),
    }
    return resolveUsageService(ctx).registerUsage(em, input, scope)
  },
}

const revertUsageCommand: CommandHandler<unknown, { ok: true; revertedCount: number }> = {
  id: 'promotions.usage.revert',
  async execute(rawInput, ctx) {
    const parsed = revertUsageInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    const input: RevertUsageInput = { orderId: parsed.orderId }
    return resolveUsageService(ctx).revertUsage(em, input, scope)
  },
}

registerCommand(registerUsageCommand)
registerCommand(revertUsageCommand)

export { registerUsageCommand, revertUsageCommand }
