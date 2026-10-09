import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PostingRulesSettings } from '../data/entities'
import { reconcileCostRingSchema, type ReconcileCostRingInput } from '../data/validators'
import { findUnreclassifiedEntries } from '../lib/findUnreclassifiedEntries'
import { isNonRetryableError, loadCandidatesForEntry, reclassifyLine } from '../lib/reclassify'

export type ReconcileCostRingFailure = { entryId: string; lineId: string; error: string }

export type ReconcileCostRingResult = {
  entriesInspected: number
  linesReclassified: number
  /** Lines that could not be reclassified (no target account resolvable,
   * locked period, ...), each with its named error. Reported, not thrown, so
   * one bad line does not stop the rest. */
  failures: ReconcileCostRingFailure[]
}

/**
 * `reconcileCostRing` — the repair sweeper (`ReconcileCostRingCommand` in
 * the spec's Design Decisions: "A repair mechanism"). Finds every source-set
 * line with no reclassification keyed on it and posts the missing entries
 * through `reclassifyLine` — the exact same idempotent code path the
 * subscriber uses (advisory lock, existence check, ensure tag), so a
 * concurrent subscriber delivery and this sweep converge on one
 * reclassification per line. A clearing account that is not configured
 * rejects the whole run with its named error; every other per-line failure
 * is returned in `failures`.
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

    const unreclassified = await findUnreclassifiedEntries(em, scope, input.periodId ?? null)
    const lineIdsByEntry = new Map<string, string[]>()
    for (const { entryId, lineId } of unreclassified) {
      lineIdsByEntry.set(entryId, [...(lineIdsByEntry.get(entryId) ?? []), lineId])
    }

    let linesReclassified = 0
    const failures: ReconcileCostRingFailure[] = []
    for (const [entryId, lineIds] of lineIdsByEntry) {
      const candidates = await loadCandidatesForEntry(em, entryId, scope, lineIds)
      for (const candidate of candidates) {
        try {
          const result = await reclassifyLine({ container: ctx.container, em, scope, translate }, candidate)
          if (result.reclassified) linesReclassified += 1
        } catch (err) {
          if (!isNonRetryableError(err)) throw err
          const body = (err as CrudHttpError).body as { error?: string } | undefined
          failures.push({ entryId, lineId: candidate.line.id, error: body?.error ?? 'Reclassification failed.' })
        }
      }
    }

    return { entriesInspected: lineIdsByEntry.size, linesReclassified, failures }
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
      payload: {
        entriesInspected: result.entriesInspected,
        linesReclassified: result.linesReclassified,
        failures: result.failures.length,
      },
    }
  },
}

registerCommand(reconcileCostRingCommand)

export { reconcileCostRingCommand }
