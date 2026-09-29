// =============================================================================
// The shared finder behind both `reconcileCostRing` (the sweeper) and
// `posting_rules.lockFiscalPeriod` (the guard) — see the spec's Architecture
// § Commands: "`reconcileCostRing`... Selection is defined purely by
// absence of a matching reference... what `findUnreclassifiedEntries`
// (shared with `lockFiscalPeriod`'s guard) already implements."
// =============================================================================

import type { EntityManager } from '@mikro-orm/postgresql'
import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../ledger/data/entities'
import { RECLASSIFICATION_REFERENCE_TYPE } from './reclassify'

export type ReconcileScope = { organizationId: string; tenantId: string }

/**
 * **Disclosed judgment call**: `JournalEntry.referenceId` is an entry-level
 * pointer, not a per-line one — there is no column in this schema that
 * records "line X of entry Y was reclassified". When an entry has more than
 * one zespół-4 line, this can only compare *how many* zespół-4 lines the
 * entry has against *how many* reclassification entries reference it, not
 * which specific lines are covered. This finder therefore flags an entry as
 * unreclassified whenever its reclassification-entry count is strictly less
 * than its zespół-4 line count — correct in the common (0 zespół-4 lines or
 * exactly 1) case, and conservative (never silently skips a genuinely
 * incomplete entry) in the rarer multi-line case, at the cost of
 * `reconcileCostRing` occasionally re-examining an entry that turns out, on
 * closer per-line inspection, to already be fully covered (see
 * `pickUnreclassifiedLines` in `commands/reconcileCostRing.ts`, which does
 * that closer inspection before actually posting anything).
 */
export async function findUnreclassifiedEntries(
  em: EntityManager,
  scope: ReconcileScope,
  periodId?: string | null,
): Promise<string[]> {
  const entryFilter: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    referenceType: { $ne: RECLASSIFICATION_REFERENCE_TYPE },
  }

  if (periodId) {
    const period = await em.findOne(FiscalPeriod, {
      id: periodId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (period) {
      entryFilter.operationDate = { $gte: period.startDate, $lte: period.endDate }
    }
  }

  const entries = await em.find(JournalEntry, entryFilter as never)
  if (entries.length === 0) return []

  const entryIds = entries.map((entry) => entry.id)
  const allLines = await em.find(JournalEntryLine, {
    journalEntryId: { $in: entryIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  const accountIds = [...new Set(allLines.map((line) => line.accountId))]
  const accounts = accountIds.length
    ? await em.find(LedgerAccount, { id: { $in: accountIds }, organizationId: scope.organizationId, tenantId: scope.tenantId })
    : []
  const accountTypeIds = [...new Set(accounts.map((account) => account.accountTypeId))]
  const accountTypes = accountTypeIds.length
    ? await em.find(LedgerAccountType, { id: { $in: accountTypeIds }, organizationId: scope.organizationId, tenantId: scope.tenantId })
    : []
  const accountGroupIds = [...new Set(accountTypes.map((type) => type.accountGroupId).filter((id): id is string => Boolean(id)))]
  const accountGroups = accountGroupIds.length
    ? await em.find(LedgerAccountGroup, { id: { $in: accountGroupIds }, organizationId: scope.organizationId, tenantId: scope.tenantId })
    : []

  const zespol4GroupIds = new Set(
    accountGroups.filter((group) => group.jurisdiction === 'PL' && group.code === '4').map((group) => group.id),
  )
  const zespol4TypeIds = new Set(
    accountTypes.filter((type) => type.accountGroupId && zespol4GroupIds.has(type.accountGroupId)).map((type) => type.id),
  )
  const zespol4AccountIds = new Set(
    accounts.filter((account) => zespol4TypeIds.has(account.accountTypeId)).map((account) => account.id),
  )

  const zespol4LineCountByEntry = new Map<string, number>()
  for (const line of allLines) {
    if (!zespol4AccountIds.has(line.accountId)) continue
    zespol4LineCountByEntry.set(line.journalEntryId, (zespol4LineCountByEntry.get(line.journalEntryId) ?? 0) + 1)
  }
  if (zespol4LineCountByEntry.size === 0) return []

  const candidateEntryIds = [...zespol4LineCountByEntry.keys()]
  const reclassifications = await em.find(JournalEntry, {
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: { $in: candidateEntryIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const reclassificationCountByEntry = new Map<string, number>()
  for (const reclassification of reclassifications) {
    const sourceId = reclassification.referenceId as string
    reclassificationCountByEntry.set(sourceId, (reclassificationCountByEntry.get(sourceId) ?? 0) + 1)
  }

  const unreclassified: string[] = []
  for (const [entryId, zespol4Count] of zespol4LineCountByEntry) {
    const reclassifiedCount = reclassificationCountByEntry.get(entryId) ?? 0
    if (reclassifiedCount < zespol4Count) unreclassified.push(entryId)
  }
  return unreclassified
}
