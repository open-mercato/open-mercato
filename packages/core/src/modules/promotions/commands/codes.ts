import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  codeReservationReleaseSchema,
  codeReserveInputSchema,
  codeUseInputSchema,
} from '../data/validators'
import { PromotionCodeService, type PromotionsCodeScope } from '../lib/code-service'
import type { CodeReservationResult, CodeUseResult } from '../lib/types'

// SPEC-055 §Amendment A.2a: `reserveCode`, `releaseCode` and `useCode` are "financially
// or budget consequential writes" and go through the command pattern the same as
// `Promotion`/`Code` CRUD. `validateCode`/`extendReservation` are deliberately NOT here
// — §A.2a names exactly five commands for the whole of Phase 3
// (`reserve`/`release`/`use`/`usage.register`/`usage.revert`; the last two are Step
// 6.3's), and the spec explicitly calls `validateCode`/`extendReservation` plain
// reads/housekeeping with no mutation to command-wrap.
//
// Each command wraps `lib/code-service.ts`'s `PromotionCodeService` — the actual
// resolution/locking/transaction logic lives there (§Code Lifecycle,
// §Promotion Usage Lifecycle's row-lock correction applied to `codes/use`); this file
// only resolves the command-runtime scope/EntityManager and dispatches to it, same split
// as `commands/promotions.ts`'s thin command bodies around `data/validators.ts` schemas.

// Mirrors `commands/promotions.ts`'s `resolveActorScope` — a code operation's
// tenant/organization scope is always the caller's own actor scope (never a
// client-supplied value), resolved from `ctx.auth`/`ctx.selectedOrganizationId`.
function resolveActorScope(ctx: CommandRuntimeContext): PromotionsCodeScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: '[internal] Tenant and organization scope are required for a promotion code operation',
    })
  }
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

// `ctx.transactionalEm`, when set, is an already-open (possibly ambient — e.g.
// `checkout`'s own) transaction this command MUST reuse rather than opening its own
// (§Promotion Usage Lifecycle's row-lock correction depends on this for `codes/use`:
// locking inside the SAME transaction as the caller is what makes the lock effective
// whether the call is top-level or nested). Otherwise fork the request `em`, same
// precedent as every other command in this module.
function resolveCommandEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
}

function resolveCodeService(ctx: CommandRuntimeContext): PromotionCodeService {
  return ctx.container.resolve('promotionCodeService') as PromotionCodeService
}

const reserveCodeCommand: CommandHandler<unknown, CodeReservationResult> = {
  id: 'promotions.code.reserve',
  async execute(rawInput, ctx) {
    const parsed = codeReserveInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    return resolveCodeService(ctx).reserveCode(em, parsed, scope)
  },
}

const releaseCodeCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'promotions.code.release',
  async execute(rawInput, ctx) {
    const parsed = codeReservationReleaseSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    await resolveCodeService(ctx).releaseCode(em, parsed.codeId, parsed.cartId, scope)
    return { ok: true }
  },
}

const useCodeCommand: CommandHandler<unknown, CodeUseResult> = {
  id: 'promotions.code.use',
  async execute(rawInput, ctx) {
    const parsed = codeUseInputSchema.parse(rawInput)
    const scope = resolveActorScope(ctx)
    const em = resolveCommandEm(ctx)
    return resolveCodeService(ctx).useCode(em, parsed, scope)
  },
}

registerCommand(reserveCodeCommand)
registerCommand(releaseCodeCommand)
registerCommand(useCodeCommand)

export { reserveCodeCommand, releaseCodeCommand, useCodeCommand }
