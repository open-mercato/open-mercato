// =============================================================================
// The shared "reclassify one line" helper.
// =============================================================================
//
// Used by both `subscribers/postingRulesEngineSubscriber.ts` (the real-time
// event path) and `commands/reconcileCostRing.ts` (the repair sweeper) — per
// the spec's Implementation Plan step 6, "reusing the subscriber's
// reclassify-one-line logic as a shared internal helper, not duplicated".
//
// See `.ai/specs/2026-09-06-posting-rules-engine.md` § Design Decisions
// ("The MPK (cost centre) dimension: a priority hybrid", "Reversals are
// mirrored, not duplicated", "The engine's own postings carry a distinct
// `referenceType`") and § Events & Subscribers for the full rationale this
// file implements.
// =============================================================================

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import type { PostJournalEntryInput } from '../../ledger/data/validators'
import type { PostJournalEntryResult } from '../../ledger/commands/postJournalEntry'
import { JournalEntry, JournalEntryLine, LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../ledger/data/entities'
import { JournalEntryLineDimension } from '../../journal_entry_line_dimension/data/entities'
import type { SetJournalEntryLineDimensionInput } from '../../journal_entry_line_dimension/data/validators'
import { CostCenter, DefaultAccountPostingRule, PostingRulesSettings } from '../data/entities'
import { UNALLOCATED_COST_CENTER_CODE } from './seedDefaults'

/** The marker this engine's own output carries — see Design Decisions,
 * "The engine's own postings carry a distinct `referenceType`". Checked
 * first by the subscriber (ignore own output, Invariant 3) and used by
 * `reconcileCostRing`'s finder to tell an already-reclassified line apart
 * from one #5663's own `REVERSAL` linkage (`referenceType: 'journal_entry'`)
 * would otherwise be confused with. */
export const RECLASSIFICATION_REFERENCE_TYPE = 'PostingRulesEngineReclassification'

export type Scope = { organizationId: string; tenantId: string }

/**
 * A normalized posted-line candidate, built either from the
 * `ledger.journal_entry.posted` event payload (subscriber) or from a fresh
 * DB read (`reconcileCostRing`'s scan) — the rest of this file doesn't care
 * which.
 */
export type ReclassifyCandidate = {
  entry: {
    id: string
    operationDate: string
    currencyId: string
    type: 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL'
    referenceType: string | null
    referenceId: string | null
  }
  line: {
    id: string
    accountId: string
    debit: string
    credit: string
  }
}

export type ReclassifyDeps = {
  container: AwilixContainer
  em: EntityManager
  scope: Scope
  translate: TranslateWithFallbackFn
}

export type ReclassifyResult =
  | { reclassified: false; reason: 'not_zespol_4' | 'already_engine_output' }
  | { reclassified: true; journalEntryId: string }

function amountOf(line: { debit: string; credit: string }): { amount: string; side: 'debit' | 'credit' } {
  const debit = Number(line.debit)
  return debit > 0 ? { amount: line.debit, side: 'debit' } : { amount: line.credit, side: 'credit' }
}

/**
 * Whether `accountId` resolves to a zespół 4 account —
 * `LedgerAccount.accountTypeId` → `LedgerAccountType.accountGroupId` →
 * `LedgerAccountGroup{jurisdiction: 'PL', code: '4'}` (see Design
 * Decisions, "Detecting 'zespół 4'"). Direct cross-module entity reads,
 * bypassing the command layer, per the spec's Cross-module integration
 * (the same hard-dependency precedent `journal_entry_line_dimension`
 * documents for `fixed_assets`).
 */
async function resolveAccountClassification(
  em: EntityManager,
  accountId: string,
  scope: Scope,
): Promise<{ isZespol4: boolean; normalBalance: 'DEBIT' | 'CREDIT' | null }> {
  const account = await em.findOne(LedgerAccount, {
    id: accountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!account) return { isZespol4: false, normalBalance: null }

  const accountType = await em.findOne(LedgerAccountType, {
    id: account.accountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!accountType || !accountType.accountGroupId) {
    return { isZespol4: false, normalBalance: (accountType?.normalBalance as 'DEBIT' | 'CREDIT' | undefined) ?? null }
  }

  const group = await em.findOne(LedgerAccountGroup, {
    id: accountType.accountGroupId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const isZespol4 = Boolean(group && group.jurisdiction === 'PL' && group.code === '4')
  return { isZespol4, normalBalance: accountType.normalBalance }
}

async function loadDefaultAccountPostingRule(
  em: EntityManager,
  sourceAccountId: string,
  scope: Scope,
): Promise<DefaultAccountPostingRule | null> {
  return em.findOne(DefaultAccountPostingRule, {
    sourceAccountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
}

async function loadSettings(em: EntityManager, scope: Scope): Promise<PostingRulesSettings | null> {
  return em.findOne(PostingRulesSettings, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
}

async function loadSentinelCostCenterId(em: EntityManager, scope: Scope, translate: TranslateWithFallbackFn): Promise<string> {
  const sentinel = await em.findOne(CostCenter, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    code: UNALLOCATED_COST_CENTER_CODE,
    deletedAt: null,
  })
  if (!sentinel) {
    // Should never happen — `seedDefaults` seeds this at module-enable
    // time — but a missing sentinel means the hybrid's third path has
    // nothing to tag with, so this must reject rather than post an
    // untagged line (`setJournalEntryLineDimension`'s own
    // `dimensionIds: z.array(...).min(1)` would reject that anyway).
    throw new CrudHttpError(422, {
      error: translate(
        'posting_rules.errors.sentinelCostCenterMissing',
        'The sentinel "UNALLOCATED" cost centre is missing for this organization. Re-run module setup.',
      ),
    })
  }
  return sentinel.id
}

/** Explicit `journal_entry_line_dimension` tag on the source line itself —
 * the hybrid's first, highest-priority path (see Design Decisions). Direct
 * cross-module entity read, same precedent as `resolveAccountClassification`. */
async function loadExplicitCostCenterTag(
  em: EntityManager,
  journalEntryLineId: string,
  scope: Scope,
): Promise<string | null> {
  const row = await em.findOne(JournalEntryLineDimension, {
    journalEntryLineId,
    dimensionType: 'CostCenter',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return row?.dimensionId ?? null
}

async function loadCostCenterTagsForLine(
  em: EntityManager,
  journalEntryLineId: string,
  scope: Scope,
): Promise<string[]> {
  const rows = await em.find(JournalEntryLineDimension, {
    journalEntryLineId,
    dimensionType: 'CostCenter',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return rows.map((row) => row.dimensionId)
}

async function tagCostCenter(
  ctx: CommandRuntimeContext,
  container: AwilixContainer,
  journalEntryLineId: string,
  costCenterId: string,
): Promise<void> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const input: SetJournalEntryLineDimensionInput = {
    journalEntryLineId,
    dimensionType: 'CostCenter',
    dimensionIds: [costCenterId],
  }
  await commandBus.execute<SetJournalEntryLineDimensionInput, unknown>(
    'journal_entry_line_dimension.setJournalEntryLineDimension',
    { input, ctx },
  )
}

function buildCommandRuntimeContext(container: AwilixContainer, scope: Scope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    // `systemActor: true` — this engine posts on nobody's behalf; it
    // reacts to an already-committed event, not a user action, matching
    // `auto-vendor-recovery.ts`'s own `ctx.auth: null` shape for the same
    // kind of system-triggered follow-up write.
    systemActor: true,
  } as CommandRuntimeContext
}

async function postReclassification(
  container: AwilixContainer,
  scope: Scope,
  input: {
    operationDate: string
    currencyId: string
    description: string
    referenceId: string
    debitAccountId: string
    creditAccountId: string
    amount: string
  },
): Promise<PostJournalEntryResult> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const ctx = buildCommandRuntimeContext(container, scope)
  const postInput: PostJournalEntryInput = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    operationDate: new Date(input.operationDate),
    description: input.description,
    currencyId: input.currencyId,
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: input.referenceId,
    lines: [
      { accountId: input.debitAccountId, debit: input.amount },
      { accountId: input.creditAccountId, credit: input.amount },
    ],
  }
  // `commandBus.execute` resolves `CommandExecuteResult<TResult>` (`{ result,
  // logEntry }`), never the bare command result — unwrap `.result` here.
  const executed = await commandBus.execute<PostJournalEntryInput, PostJournalEntryResult>('ledger.postJournalEntry', {
    input: postInput,
    ctx,
  })
  return executed.result
}

/**
 * Finds the reclassification entry (and its debit/target line) that a
 * contra-side (reversal) line should mirror — see Design Decisions,
 * "Reversals are mirrored, not duplicated".
 *
 * **Disclosed judgment call**: entry-level `referenceId` linkage cannot by
 * itself disambiguate which reclassification corresponds to which specific
 * line when the reversed entry had more than one zespół-4 line (the spec
 * flags this as unresolved — see this module's own knowledge). This
 * implementation disambiguates, in order: (1) if exactly one
 * reclassification entry references `originalEntryId`, use it directly;
 * (2) otherwise, match by the reclassified amount (the reversal line's own
 * populated amount, which mirrors the original debit exactly); (3) if still
 * ambiguous, prefer the candidate whose debit-line account matches the
 * *current* `DefaultAccountPostingRule` resolution for this account,
 * falling back to the first amount match. This is a best-effort heuristic,
 * not a DB-enforced guarantee — a future revision could close this
 * properly by carrying a per-line reference, which does not exist today.
 */
async function findOriginalReclassification(
  em: EntityManager,
  originalEntryId: string,
  reversalLine: { accountId: string; amount: string },
  scope: Scope,
): Promise<{ journalEntryId: string; debitAccountId: string; debitLineId: string } | null> {
  const candidates = await em.find(JournalEntry, {
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: originalEntryId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (candidates.length === 0) return null

  type Candidate = { journalEntryId: string; debitAccountId: string; debitLineId: string; amount: string }
  const resolved: Candidate[] = []
  for (const candidate of candidates) {
    const lines = await em.find(JournalEntryLine, {
      journalEntryId: candidate.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    const debitLine = lines.find((line) => Number(line.debit) > 0)
    if (!debitLine) continue
    resolved.push({
      journalEntryId: candidate.id,
      debitAccountId: debitLine.accountId,
      debitLineId: debitLine.id,
      amount: debitLine.debit,
    })
  }
  if (resolved.length === 0) return null
  if (resolved.length === 1) return resolved[0]

  const amountMatches = resolved.filter((candidate) => candidate.amount === reversalLine.amount)
  if (amountMatches.length === 1) return amountMatches[0]

  const pool = amountMatches.length > 0 ? amountMatches : resolved
  const rule = await loadDefaultAccountPostingRule(em, reversalLine.accountId, scope)
  if (rule) {
    const ruleMatch = pool.find((candidate) => candidate.debitAccountId === rule.targetAccountId)
    if (ruleMatch) return ruleMatch
  }
  return pool[0]
}

/**
 * Used by `reconcileCostRing` to decide, for one already-loaded `entry`,
 * which of its zespół-4 lines still need a reclassification posted —
 * closer, per-line inspection on top of `findUnreclassifiedEntries`'s
 * coarser, entry-level absence check (see that file's own disclosed
 * judgment call). Resolves each zespół-4 line's target account the normal
 * way (`DefaultAccountPostingRule` → `PostingRulesSettings.unallocatedCostAccountId`)
 * and treats a line as already covered when a reclassification entry
 * already referencing this source entry has a debit line on that exact
 * target account — consuming one match per reclassification entry, so two
 * source lines that happen to resolve to the same target account are each
 * matched against a distinct existing reclassification, not double-counted
 * against a single one.
 */
export async function selectLinesNeedingReclassification(
  em: EntityManager,
  entry: { id: string; organizationId: string; tenantId: string },
  scope: Scope,
): Promise<JournalEntryLine[]> {
  const lines = await em.find(JournalEntryLine, {
    journalEntryId: entry.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  const zespol4Lines: JournalEntryLine[] = []
  for (const line of lines) {
    const { isZespol4 } = await resolveAccountClassification(em, line.accountId, scope)
    if (isZespol4) zespol4Lines.push(line)
  }
  if (zespol4Lines.length === 0) return []

  const existingReclassifications = await em.find(JournalEntry, {
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: entry.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const coveredTargetAccountIds: string[] = []
  for (const reclassification of existingReclassifications) {
    const reclassificationLines = await em.find(JournalEntryLine, {
      journalEntryId: reclassification.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    const debitLine = reclassificationLines.find((line) => Number(line.debit) > 0)
    if (debitLine) coveredTargetAccountIds.push(debitLine.accountId)
  }

  const needsReclassification: JournalEntryLine[] = []
  for (const line of zespol4Lines) {
    const rule = await loadDefaultAccountPostingRule(em, line.accountId, scope)
    const settings = await loadSettings(em, scope)
    const targetAccountId = rule?.targetAccountId ?? settings?.unallocatedCostAccountId ?? null
    const coveredIndex = targetAccountId ? coveredTargetAccountIds.indexOf(targetAccountId) : -1
    if (coveredIndex >= 0) {
      coveredTargetAccountIds.splice(coveredIndex, 1)
      continue
    }
    needsReclassification.push(line)
  }
  return needsReclassification
}

/**
 * Reclassifies exactly one posted `JournalEntryLine`, if it names a
 * zespół 4 account and doesn't already carry this engine's own marker.
 * Idempotent from the caller's point of view: a line that doesn't
 * qualify is a no-op, never an error.
 */
export async function reclassifyLine(
  deps: ReclassifyDeps,
  candidate: ReclassifyCandidate,
): Promise<ReclassifyResult> {
  const { container, em, scope, translate } = deps

  // Invariant 3 — never react to this engine's own prior output. Checked
  // by the subscriber before calling this helper too, but re-checked here
  // so `reconcileCostRing` (which calls this helper against lines it found
  // by other means) gets the same guarantee for free.
  if (candidate.entry.referenceType === RECLASSIFICATION_REFERENCE_TYPE) {
    return { reclassified: false, reason: 'already_engine_output' }
  }

  const { isZespol4, normalBalance } = await resolveAccountClassification(em, candidate.line.accountId, scope)
  if (!isZespol4 || !normalBalance) {
    return { reclassified: false, reason: 'not_zespol_4' }
  }

  const { amount, side } = amountOf(candidate.line)
  const normalSide = normalBalance === 'DEBIT' ? 'debit' : 'credit'
  const isNormalSide = side === normalSide

  const settings = await loadSettings(em, scope)
  const clearingAccountId = settings?.clearingAccountId ?? null
  if (!clearingAccountId) {
    throw new CrudHttpError(422, {
      error: translate(
        'posting_rules.errors.clearingAccountNotConfigured',
        'The technical clearing account (PostingRulesSettings.clearingAccountId) is not configured for this organization.',
      ),
    })
  }

  const description = translate(
    'posting_rules.reclassification.description',
    'Automatic zespół 4→5 cost reclassification of entry #{entryId}',
    { entryId: candidate.entry.id },
  )

  if (isNormalSide) {
    const rule = await loadDefaultAccountPostingRule(em, candidate.line.accountId, scope)
    let targetAccountId: string | null = rule?.targetAccountId ?? null
    if (!targetAccountId) {
      targetAccountId = settings?.unallocatedCostAccountId ?? null
    }
    if (!targetAccountId) {
      throw new CrudHttpError(422, {
        error: translate(
          'posting_rules.errors.noTargetAccountResolved',
          'No DefaultAccountPostingRule matches this account and PostingRulesSettings.unallocatedCostAccountId is not configured.',
        ),
      })
    }

    const explicitTag = await loadExplicitCostCenterTag(em, candidate.line.id, scope)
    const costCenterId = explicitTag ?? rule?.defaultCostCenterId ?? (await loadSentinelCostCenterId(em, scope, translate))

    const result = await postReclassification(container, scope, {
      operationDate: candidate.entry.operationDate,
      currencyId: candidate.entry.currencyId,
      description,
      referenceId: candidate.entry.id,
      debitAccountId: targetAccountId,
      creditAccountId: clearingAccountId,
      amount,
    })

    const debitLine = result.lines.find((line) => line.accountId === targetAccountId) ?? result.lines[0]
    const ctx = buildCommandRuntimeContext(container, scope)
    await tagCostCenter(ctx, container, debitLine.id, costCenterId)

    return { reclassified: true, journalEntryId: result.journalEntryId }
  }

  // Contra side — a storno/correction. Mirror the original reclassification
  // rather than re-resolving the hybrid (Invariant 5, Design Decisions).
  const originalEntryId = candidate.entry.referenceId
  if (!originalEntryId) {
    throw new CrudHttpError(422, {
      error: translate(
        'posting_rules.errors.reversalMissingReference',
        'This entry posts a contra-side zespół 4 line but carries no referenceId back to the entry it reverses.',
      ),
    })
  }

  const original = await findOriginalReclassification(em, originalEntryId, { accountId: candidate.line.accountId, amount }, scope)
  if (!original) {
    throw new CrudHttpError(422, {
      error: translate(
        'posting_rules.errors.noPriorReclassificationForReversal',
        'No prior reclassification was found for the entry this reversal points back to.',
      ),
    })
  }

  const reusedCostCenterIds = await loadCostCenterTagsForLine(em, original.debitLineId, scope)
  const costCenterId = reusedCostCenterIds[0] ?? (await loadSentinelCostCenterId(em, scope, translate))

  const result = await postReclassification(container, scope, {
    operationDate: candidate.entry.operationDate,
    currencyId: candidate.entry.currencyId,
    description,
    referenceId: candidate.entry.id,
    debitAccountId: clearingAccountId,
    creditAccountId: original.debitAccountId,
    amount,
  })

  // Tag the mirror's *target-account* line — the credit side here, since
  // the mirror swaps debit/credit relative to the normal-side post above —
  // found by accountId, not by debit/credit side.
  const targetLine = result.lines.find((line) => line.accountId === original.debitAccountId) ?? result.lines[0]
  const ctx = buildCommandRuntimeContext(container, scope)
  await tagCostCenter(ctx, container, targetLine.id, costCenterId)

  return { reclassified: true, journalEntryId: result.journalEntryId }
}
