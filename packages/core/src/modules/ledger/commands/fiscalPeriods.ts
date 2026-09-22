import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FiscalPeriod } from '../data/entities'
import {
  createFiscalPeriodSchema,
  lockFiscalPeriodSchema,
  unlockFiscalPeriodSchema,
  type CreateFiscalPeriodInput,
  type LockFiscalPeriodInput,
  type UnlockFiscalPeriodInput,
} from '../data/validators'

const FISCAL_PERIOD_RESOURCE_KIND = 'ledger.fiscal_period'

type Scope = { organizationId: string; tenantId: string }

/**
 * `FiscalPeriod` rows for one organization must not overlap (added
 * 2026-09-18 — see Design decisions, M1 fix): otherwise "the covering
 * period" for a given `operationDate` in `postJournalEntry` would be
 * ambiguous, and an unlocked period could shadow a locked one covering the
 * same range. An exclusion constraint is Phase 2 (see Out of scope); this
 * app-layer check is the documented Phase 1 guard.
 * Overlap test: `existing.startDate <= new.endDate AND existing.endDate >= new.startDate`.
 */
async function findOverlappingFiscalPeriod(
  em: EntityManager,
  scope: Scope,
  startDate: Date,
  endDate: Date,
): Promise<FiscalPeriod | null> {
  return em.findOne(FiscalPeriod, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  })
}

export type FiscalPeriodDto = { id: string; isLocked: boolean; updatedAt: string }

const createFiscalPeriodCommand: CommandHandler<CreateFiscalPeriodInput, { fiscalPeriodId: string }> = {
  id: 'ledger.createFiscalPeriod',
  async execute(rawInput, ctx) {
    const input = createFiscalPeriodSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }

    const overlapping = await findOverlappingFiscalPeriod(em, scope, input.startDate, input.endDate)
    if (overlapping) {
      throw conflict('This date range overlaps an existing fiscal period for this organization.')
    }

    const now = new Date()
    const period = em.create(FiscalPeriod, {
      id: randomUUID(),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      startDate: input.startDate,
      endDate: input.endDate,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(period)
    await em.flush()

    return { fiscalPeriodId: period.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.createFiscalPeriod', 'Create fiscal period'),
      resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
      resourceId: result.fiscalPeriodId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

/**
 * Shared body for `lockFiscalPeriod`/`unlockFiscalPeriod`: load the scoped
 * period, enforce the optimistic-lock guard against the caller's
 * `x-om-ext-optimistic-lock-expected-updated-at` header, flip `isLocked`,
 * persist. Both commands require `ledger.periods.manage` (enforced at the
 * API-route layer — see OM-11 — not inside the command itself, matching
 * this codebase's convention of ACL feature checks living on the route).
 */
async function toggleFiscalPeriodLock(
  ctx: CommandRuntimeContext,
  rawInput: unknown,
  isLocked: boolean,
): Promise<FiscalPeriodDto> {
  const input = (isLocked ? lockFiscalPeriodSchema : unlockFiscalPeriodSchema).parse(rawInput ?? {})
  ensureTenantScope(ctx, input.tenantId)
  ensureOrganizationScope(ctx, input.organizationId)

  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }

  const period = await em.findOne(FiscalPeriod, {
    id: input.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!period) {
    // Concurrent-delete race: if the client sent the expected-version
    // header, surface the unified 409 conflict instead of a bare 404 (see
    // optimistic-lock-command.ts's own documented usage pattern).
    enforceRecordGoneIsConflict({
      resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
      resourceId: input.id,
      request: ctx.request ?? null,
    })
    throw notFound('Fiscal period not found.')
  }

  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
    resourceId: period.id,
    current: period.updatedAt,
    request: ctx.request ?? null,
  })

  period.isLocked = isLocked
  period.updatedAt = new Date()
  await em.flush()

  return { id: period.id, isLocked: period.isLocked, updatedAt: period.updatedAt.toISOString() }
}

const lockFiscalPeriodCommand: CommandHandler<LockFiscalPeriodInput, FiscalPeriodDto> = {
  id: 'ledger.lockFiscalPeriod',
  async execute(rawInput, ctx) {
    return toggleFiscalPeriodLock(ctx, rawInput, true)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.lockFiscalPeriod', 'Lock fiscal period'),
      resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const unlockFiscalPeriodCommand: CommandHandler<UnlockFiscalPeriodInput, FiscalPeriodDto> = {
  id: 'ledger.unlockFiscalPeriod',
  async execute(rawInput, ctx) {
    return toggleFiscalPeriodLock(ctx, rawInput, false)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.unlockFiscalPeriod', 'Unlock fiscal period'),
      resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createFiscalPeriodCommand)
registerCommand(lockFiscalPeriodCommand)
registerCommand(unlockFiscalPeriodCommand)
