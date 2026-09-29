import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { JournalEntry } from '../../ledger/data/entities'
import { PostingRulesSettings } from '../data/entities'
import { reconcileCostRingSchema, type ReconcileCostRingInput } from '../data/validators'
import { findUnreclassifiedEntries } from '../lib/findUnreclassifiedEntries'
import { reclassifyLine, selectLinesNeedingReclassification, type ReclassifyCandidate } from '../lib/reclassify'

export type ReconcileCostRingResult = {
  entriesInspected: number
  linesReclassified: number
}

/**
 * `reconcileCostRing` — the repair sweeper (`ReconcileCostRingCommand` in
 * the spec's Design Decisions: "A repair mechanism"). Finds every zespół 4
 * `JournalEntryLine` with no corresponding reclassification and posts the
 * missing entries, reusing `reclassifyLine` — the exact same logic path the
 * subscriber uses (Implementation Plan step 6: "reusing the subscriber's
 * reclassify-one-line logic as a shared internal helper, not duplicated").
 * Idempotent: an already-reclassified line no longer matches
 * `findUnreclassifiedEntries`'s absence-based search and is never picked up
 * twice (Architecture § Commands).
 */
const reconcileCostRingCommand: CommandHandler<ReconcileCostRingInput, ReconcileCostRingResult> = {
  id: 'posting_rules.reconcileCostRing',
  async execute(rawInput, ctx) {
    const input = reconcileCostRingSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
    const { translate } = await resolveTranslations()

    const settings = await em.findOne(PostingRulesSettings, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (!settings?.clearingAccountId) {
      throw new CrudHttpError(422, {
        error: translate(
          'posting_rules.errors.clearingAccountNotConfigured',
          'The technical clearing account (PostingRulesSettings.clearingAccountId) is not configured for this organization.',
        ),
      })
    }

    const unreclassifiedEntryIds = await findUnreclassifiedEntries(em, scope, input.periodId ?? null)

    let linesReclassified = 0
    for (const entryId of unreclassifiedEntryIds) {
      const entry = await em.findOne(JournalEntry, {
        id: entryId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      if (!entry) continue

      const linesNeedingReclassification = await selectLinesNeedingReclassification(em, entry, scope)
      for (const line of linesNeedingReclassification) {
        const candidate: ReclassifyCandidate = {
          entry: {
            id: entry.id,
            operationDate: entry.operationDate.toISOString().slice(0, 10),
            currencyId: entry.currencyId,
            type: entry.type,
            referenceType: entry.referenceType ?? null,
            referenceId: entry.referenceId ?? null,
          },
          line: {
            id: line.id,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
          },
        }
        const result = await reclassifyLine({ container: ctx.container, em, scope, translate }, candidate)
        if (result.reclassified) linesReclassified += 1
      }
    }

    return { entriesInspected: unreclassifiedEntryIds.length, linesReclassified }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('posting_rules.audit.reconcileCostRing', 'Run posting rules reconciliation sweep'),
      resourceKind: 'posting_rules.reconcile_run',
      resourceId: `${input?.organizationId ?? ''}:${input?.tenantId ?? ''}`,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: { entriesInspected: result.entriesInspected, linesReclassified: result.linesReclassified },
    }
  },
}

registerCommand(reconcileCostRingCommand)

export { reconcileCostRingCommand }
