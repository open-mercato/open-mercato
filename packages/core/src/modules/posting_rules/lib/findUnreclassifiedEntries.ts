// =============================================================================
// The shared finder behind both `reconcileCostRing` (the sweeper) and
// `posting_rules.lockFiscalPeriod` (the guard) — see the spec's Architecture
// § Commands: "`reconcileCostRing`... Selection is defined purely by
// absence of a matching reference."
// =============================================================================

import type { EntityManager } from '@mikro-orm/postgresql'
import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../ledger/data/entities'
import { PostingRulesSettings } from '../data/entities'
import { RECLASSIFICATION_REFERENCE_TYPE, TRIGGER_ENTRY_TYPES } from './reclassify'

export type ReconcileScope = { organizationId: string; tenantId: string }

/** One source-set line that has no reclassification keyed on it. */
export type UnreclassifiedLine = { entryId: string; lineId: string }

/**
 * Returns every line of the *source set* that has no reclassification yet
 * (spec, Design Decisions, "Which entries and lines the engine reacts to";
 * Invariant 1). The predicate is at line granularity: a line is covered
 * when an entry exists whose marker `referenceId` is that line's id. It is
 * deliberately not a comparison of reclassification counts per source entry
 * — an entry-level count cannot tell a fully from a partly reclassified
 * multi-line entry, so a period could be locked with a line still missing.
 *
 * The source set is: lines of `NORMAL` and `REVERSAL` entries that do not
 * carry the engine's own marker, on a zespół 4 account that is not the
 * clearing account. The subscriber applies the same definition
 * (`reclassifyLine`).
 */
export async function findUnreclassifiedEntries(
  em: EntityManager,
  scope: ReconcileScope,
  periodId?: string | null,
): Promise<UnreclassifiedLine[]> {
  const entryFilter: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    type: { $in: [...TRIGGER_ENTRY_TYPES] },
    // `$ne` only becomes a null-safe `is not` when the *compared value*
    // is null (see @mikro-orm/sql QueryBuilderHelper's getOperatorReplacement) --
    // here the value is the reclassification marker string, so it compiles
    // to a plain SQL `<>`, which is UNKNOWN (excluded) for rows where
    // `reference_type IS NULL`. A perfectly ordinary journal entry with no
    // external reference legitimately has `referenceType: null`, so the
    // naive `$ne` would silently skip every such entry. This explicit `$or`
    // keeps null-referenceType entries in scope while still excluding
    // actual reclassification entries.
    $or: [
      { referenceType: null },
      { referenceType: { $ne: RECLASSIFICATION_REFERENCE_TYPE } },
    ],
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

  const settings = await em.findOne(PostingRulesSettings, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const clearingAccountId = settings?.clearingAccountId ?? null

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

  // The clearing account is never a source (it resolves to `code: '4'`).
  const sourceLines = allLines.filter(
    (line) => zespol4AccountIds.has(line.accountId) && line.accountId !== clearingAccountId,
  )
  if (sourceLines.length === 0) return []

  const reclassifications = await em.find(JournalEntry, {
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: { $in: sourceLines.map((line) => line.id) },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const covered = new Set(reclassifications.map((entry) => entry.referenceId as string))

  return sourceLines
    .filter((line) => !covered.has(line.id))
    .map((line) => ({ entryId: line.journalEntryId, lineId: line.id }))
}
