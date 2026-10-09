import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { LockFiscalPeriodInput as LedgerLockFiscalPeriodInput } from '../../ledger/data/validators'
import type { FiscalPeriodDto } from '../../ledger/commands/fiscalPeriods'
import { postingRulesLockFiscalPeriodSchema, type PostingRulesLockFiscalPeriodInput } from '../data/validators'
import { findUnreclassifiedEntries } from '../lib/findUnreclassifiedEntries'

export type PostingRulesLockFiscalPeriodResult = {
  fiscalPeriodId: string
  isLocked: boolean
  updatedAt: string
}

/**
 * `posting_rules.lockFiscalPeriod` — this module's own guarded period
 * close, distinct from `ledger.lockFiscalPeriod` (see Design Decisions,
 * "Period-close guard: a dedicated entry point in `posting_rules`, not a
 * subscriber veto" — a subscriber cannot block `ledger.lockFiscalPeriod`,
 * since subscriber errors are only logged, never propagated). First checks
 * `findUnreclassifiedEntries(periodId)`; if non-empty, rejects with the
 * offending entry ids and does not proceed (Invariant 4). Only when empty
 * does it delegate to `ledger.lockFiscalPeriod` — an ordinary downward
 * call (consumer → dependency), the same mechanism this module already
 * uses for `postJournalEntry`.
 *
 * **Known integration gap, not addressed here** (see the spec's
 * Cross-module integration): #5663's own Fiscal Periods backend page still
 * calls `ledger.lockFiscalPeriod` directly from its Lock button — wiring
 * that button to this guard instead is a UI-layer change to `ledger`, out
 * of this module's scope. This guard only protects callers that invoke
 * `posting_rules.lockFiscalPeriod` explicitly. `posting_rules.periods.manage`
 * is therefore not enforced inside this command body — matching this
 * repo's convention of ACL feature checks living on the route/UI layer
 * (see `ledger.lockFiscalPeriod`'s own `toggleFiscalPeriodLock` comment) —
 * and awaits that same route/UI wiring once it exists.
 */
const postingRulesLockFiscalPeriodCommand: CommandHandler<PostingRulesLockFiscalPeriodInput, PostingRulesLockFiscalPeriodResult> = {
  id: 'posting_rules.lockFiscalPeriod',
  async execute(rawInput, ctx) {
    const input = postingRulesLockFiscalPeriodSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
    const { translate } = await resolveTranslations()

    const unreclassified = await findUnreclassifiedEntries(em, scope, input.periodId)
    if (unreclassified.length > 0) {
      throw new CrudHttpError(422, {
        error: translate(
          'posting_rules.errors.periodHasUnreclassifiedEntries',
          'This fiscal period cannot be locked: {count} zespół 4 lines have not yet been reclassified.',
          { count: unreclassified.length },
        ),
        unreclassifiedEntryIds: [...new Set(unreclassified.map((line) => line.entryId))],
        unreclassifiedLines: unreclassified,
      })
    }

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const ledgerInput: LedgerLockFiscalPeriodInput = {
      id: input.periodId,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    }
    // `commandBus.execute` resolves `CommandExecuteResult<TResult>`
    // (`{ result, logEntry }`), never the bare command result — unwrap
    // `.result`. `ledger.lockFiscalPeriod` itself returns `FiscalPeriodDto`
    // (`{ id, isLocked, updatedAt }`, see `fiscalPeriods.ts`), whose `id`
    // field is renamed to this command's own `fiscalPeriodId` below —
    // the two commands don't share a result shape despite both describing
    // the same fiscal period.
    const executed = await commandBus.execute<LedgerLockFiscalPeriodInput, FiscalPeriodDto>(
      'ledger.lockFiscalPeriod',
      { input: ledgerInput, ctx },
    )
    return {
      fiscalPeriodId: executed.result.id,
      isLocked: executed.result.isLocked,
      updatedAt: executed.result.updatedAt,
    }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.lockFiscalPeriod', 'Lock fiscal period (posting rules guard)'),
      resourceKind: 'posting_rules.fiscal_period_lock',
      resourceId: result.fiscalPeriodId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(postingRulesLockFiscalPeriodCommand)

export { postingRulesLockFiscalPeriodCommand }
