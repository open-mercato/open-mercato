import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
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

// PR #6340 review, m14: create/lock/unlock previously emitted no event at
// all, unlike this module's other entities. Both toggleFiscalPeriodLock
// arms emit 'updated' — see the events.ts declaration's own comment for
// why there's no separate locked/unlocked pair.
const ledgerFiscalPeriodCrudEvents: CrudEventsConfig<FiscalPeriod> = {
  module: 'ledger',
  entity: 'fiscal_period',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const ledgerFiscalPeriodCrudIndexer: CrudIndexerConfig<FiscalPeriod> = {
  entityType: E.ledger.fiscal_period,
}

/**
 * `FiscalPeriod` rows for one organization must not overlap (added
 * 2026-09-18 — see Design decisions, M1 fix): otherwise "the covering
 * period" for a given `operationDate` in `postJournalEntry` would be
 * ambiguous, and an unlocked period could shadow a locked one covering the
 * same range. An exclusion constraint is Phase 2 (see Out of scope); this
 * app-layer check is the documented Phase 1 guard — the caller
 * (`createFiscalPeriodCommand`) now runs it inside a per-(organizationId,
 * tenantId) `pg_advisory_xact_lock`, so two concurrent creates for the same
 * scope no longer both pass the check before either inserts (PR #6340
 * review, M4). That closes the race for today's Phase 1 guard; it is not a
 * substitute for the Phase 2 exclusion constraint.
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
    const { translate } = await resolveTranslations()

    // The overlap check below is check-then-insert: without serializing it,
    // two concurrent creates for the same (organizationId, tenantId) can
    // both read "no overlap" and both insert, leaving two overlapping
    // periods — which makes "the covering period" in postJournalEntry's
    // `requireCoveringUnlockedFiscalPeriod` ambiguous (PR #6340 review,
    // M4). A real exclusion constraint is the Phase 2 fix (see the comment
    // on `findOverlappingFiscalPeriod`); until then, a per-(org, tenant)
    // Postgres advisory transaction lock closes the race today by making
    // concurrent creates for the same scope queue up rather than
    // interleave. `pg_advisory_xact_lock` auto-releases at commit/rollback,
    // so nothing to clean up on either path.
    const period = await em.transactional(async (trx) => {
      await trx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
        `ledger.fiscal_period:${scope.organizationId}:${scope.tenantId}`,
      ])

      const overlapping = await findOverlappingFiscalPeriod(trx, scope, input.startDate, input.endDate)
      if (overlapping) {
        throw conflict(translate('ledger.errors.fiscalPeriodOverlap', 'This date range overlaps an existing fiscal period for this organization.'))
      }

      const now = new Date()
      const created = trx.create(FiscalPeriod, {
        id: randomUUID(),
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        startDate: input.startDate,
        endDate: input.endDate,
        isLocked: false,
        createdAt: now,
        updatedAt: now,
      })
      trx.persist(created)
      await trx.flush()
      return created
    })

    // PR #6340 review, m14: emit after the transaction commits, mirroring
    // this module's other create commands (see ledgerAccounts.ts /
    // ledgerAccountTypes.ts) — fiscal periods previously emitted nothing.
    emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: period,
      identifiers: { id: period.id, organizationId: period.organizationId, tenantId: period.tenantId },
      events: ledgerFiscalPeriodCrudEvents,
      indexer: ledgerFiscalPeriodCrudIndexer,
    })

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
  const { translate } = await resolveTranslations()

  // `PESSIMISTIC_WRITE` (`for update`), inside an explicit transaction so
  // the lock actually holds across the read and the flush below — this is
  // the other half of the M4 fix in postJournalEntry.ts's
  // `requireCoveringUnlockedFiscalPeriod`: that function takes a `for
  // share` lock on the same row, so a concurrent post and a concurrent
  // lock/unlock now serialize against each other instead of one reading a
  // stale `isLocked` value before the other commits.
  let record!: FiscalPeriod

  const dto = await em.transactional(async (trx) => {
    const period = await trx.findOne(
      FiscalPeriod,
      {
        id: input.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    if (!period) {
      // Concurrent-delete race: if the client sent the expected-version
      // header, surface the unified 409 conflict instead of a bare 404 (see
      // optimistic-lock-command.ts's own documented usage pattern).
      enforceRecordGoneIsConflict({
        resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
        resourceId: input.id,
        request: ctx.request ?? null,
      })
      throw notFound(translate('ledger.errors.fiscalPeriodNotFound', 'Fiscal period not found.'))
    }

    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: FISCAL_PERIOD_RESOURCE_KIND,
      resourceId: period.id,
      current: period.updatedAt,
      request: ctx.request ?? null,
    })

    period.isLocked = isLocked
    period.updatedAt = new Date()
    await trx.flush()

    record = period

    return { id: period.id, isLocked: period.isLocked, updatedAt: period.updatedAt.toISOString() }
  })

  // PR #6340 review, m14: emit after the transaction commits — see the
  // module-level comment on ledgerFiscalPeriodCrudEvents for why both lock
  // and unlock emit 'updated' rather than a separate locked/unlocked pair.
  emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'updated',
    entity: record,
    identifiers: { id: record.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
    events: ledgerFiscalPeriodCrudEvents,
    indexer: ledgerFiscalPeriodCrudIndexer,
  })

  return dto
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
