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
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import type { PostJournalEntryInput } from '../../ledger/data/validators'
import type { PostJournalEntryResult } from '../../ledger/commands/postJournalEntry'
import { emitLedgerEvent } from '../../ledger/events'
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

/** Entry types the engine reacts to — the source set's first condition
 * (spec, Design Decisions, "Which entries and lines the engine reacts
 * to"). `CLOSING` and `OPENING` are skipped: the year-end closing entry
 * credits every 4xx account against 490 (or 860), and reclassifying those
 * lines would wipe the functional view at year end. */
export const TRIGGER_ENTRY_TYPES = ['NORMAL', 'REVERSAL'] as const

export function isTriggerEntryType(type: string): boolean {
  return (TRIGGER_ENTRY_TYPES as readonly string[]).includes(type)
}

/**
 * A normalized posted-line candidate, built either from the
 * `ledger.journal_entry.posted` event payload plus a read of the source
 * entry (subscriber) or from a fresh DB read (`reconcileCostRing`'s scan) —
 * both go through `loadCandidatesForEntry`, so the rest of this file does
 * not care which.
 */
export type ReclassifyCandidate = {
  entry: {
    id: string
    operationDate: string
    currencyId: string
    exchangeRate?: string | null
    type: 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL'
    referenceType: string | null
    referenceId: string | null
  }
  line: {
    id: string
    accountId: string
    debit: string
    credit: string
    amountCurrency?: string
  }
}

export type ReclassifyDeps = {
  container: AwilixContainer
  em: EntityManager
  scope: Scope
  translate: TranslateWithFallbackFn
}

export type ReclassifyResult =
  | {
      reclassified: false
      reason: 'not_zespol_4' | 'already_engine_output' | 'not_in_trigger_set' | 'clearing_account' | 'already_reclassified'
    }
  | { reclassified: true; journalEntryId: string }

/** A 4xx status from a command the engine called (locked period, unknown
 * account, missing configuration) is something a retry cannot fix — the
 * subscriber logs it and leaves the line to the sweeper and the guard.
 * Anything else (database error, lock timeout) is transient and must be
 * thrown so persistent delivery retries it. */
export function isNonRetryableError(err: unknown): boolean {
  return isCrudHttpError(err) && err.status >= 400 && err.status < 500
}

// MikroORM's `'date'`-typed columns (see `ledger.JournalEntry.operationDate`)
// come back from a fresh read as a driver-formatted string ("YYYY-MM-DD"),
// not a `Date`, despite the entity's own TS annotation — the same caveat
// `ledger`'s `api/journal-entries/route.ts` documents. Format defensively.
export const formatOperationDate = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

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
  scope: Scope,
  journalEntryLineId: string,
  costCenterId: string,
): Promise<void> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const input: SetJournalEntryLineDimensionInput = {
    journalEntryLineId,
    dimensionType: 'CostCenter',
    dimensionIds: [costCenterId],
    // `resolveScope`'s ctx-only lookup is unreachable from this engine's own
    // `systemActor` context (`ctx.auth: null` below -- see
    // `buildCommandRuntimeContext`'s own doc comment): `ctx.auth?.tenantId`
    // is always null there, with no fallback field on `CommandRuntimeContext`
    // analogous to `selectedOrganizationId`. Passing the already-resolved
    // scope explicitly matches the working precedent `warranty_claims`'
    // `auto-vendor-recovery.ts` -> `create_vendor_recovery` already
    // establishes for the same systemActor shape.
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  await commandBus.execute<SetJournalEntryLineDimensionInput, unknown>(
    'journal_entry_line_dimension.setJournalEntryLineDimension',
    { input, ctx },
  )
}

function buildCommandRuntimeContext(
  container: AwilixContainer,
  scope: Scope,
  transactionalEm?: EntityManager,
): CommandRuntimeContext {
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
    // Set only for the posting itself: `ledger.postJournalEntry` honours it
    // (`withPostingTransaction`) so the per-line lock and the posting commit
    // together. `setJournalEntryLineDimension` opens its own transaction and
    // ignores it, so the tag call never gets one (see `ensureTag`).
    ...(transactionalEm ? { transactionalEm } : {}),
  } as CommandRuntimeContext
}

/** The reclassification entry keyed on `lineId`, if any — the marker is the
 * source *line's* id (spec, Design Decisions, "The engine's own postings
 * carry a distinct `referenceType`"), so "already reclassified" is decided
 * per line, never per entry. */
export async function findReclassificationEntry(
  em: EntityManager,
  lineId: string,
  scope: Scope,
): Promise<JournalEntry | null> {
  return em.findOne(JournalEntry, {
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: lineId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
}

/** Loads a source entry and its lines as `ReclassifyCandidate`s — the one
 * loader behind both the subscriber and `reconcileCostRing`. The event
 * payload carries neither `currencyId`, `exchangeRate` nor each line's
 * `amountCurrency`, all of which a reclassification copies, so the
 * subscriber reads them here too (spec, Design Decisions, "Real-time, not
 * batch"). `onlyLineIds` narrows the result to specific lines. */
export async function loadCandidatesForEntry(
  em: EntityManager,
  entryId: string,
  scope: Scope,
  onlyLineIds?: string[],
): Promise<ReclassifyCandidate[]> {
  const entry = await em.findOne(JournalEntry, {
    id: entryId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!entry) return []
  const lines = await em.find(JournalEntryLine, {
    journalEntryId: entry.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return lines
    .filter((line) => !onlyLineIds || onlyLineIds.includes(line.id))
    .map((line) => ({
      entry: {
        id: entry.id,
        operationDate: formatOperationDate(entry.operationDate),
        currencyId: entry.currencyId,
        exchangeRate: entry.exchangeRate ?? null,
        type: entry.type,
        referenceType: entry.referenceType ?? null,
        referenceId: entry.referenceId ?? null,
      },
      line: {
        id: line.id,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        amountCurrency: line.amountCurrency,
      },
    }))
}

/** A cost centre id is usable only while the row exists, is not deleted and
 * is active. A rule whose `defaultCostCenterId` points at a deactivated or
 * deleted cost centre is treated as unset (spec, Design Decisions, "The
 * sentinel `CostCenter` is protected by the commands"). */
async function activeCostCenterId(em: EntityManager, costCenterId: string | null | undefined, scope: Scope): Promise<string | null> {
  if (!costCenterId) return null
  const costCenter = await em.findOne(CostCenter, {
    id: costCenterId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return costCenter && costCenter.isActive ? costCenter.id : null
}

type ResolvedPlan = { debitAccountId: string; creditAccountId: string; clearingAccountId: string; costCenterId: string }

/**
 * Resolves the target account and `CostCenter` for a line the way the
 * normal side does — `DefaultAccountPostingRule`, falling back to
 * `PostingRulesSettings.unallocatedCostAccountId`; explicit tag, then the
 * rule's active default, then the sentinel. `inverted` flips the direction
 * for a contra-side line that has no original reclassification to mirror
 * (a vendor credit note, a 4xx→4xx reclassification, a reversal whose
 * original was never reclassified).
 */
async function resolveRulePlan(
  deps: ReclassifyDeps,
  candidate: ReclassifyCandidate,
  settings: PostingRulesSettings,
  inverted: boolean,
): Promise<ResolvedPlan> {
  const { em, scope, translate } = deps
  const clearingAccountId = settings.clearingAccountId as string
  const rule = await loadDefaultAccountPostingRule(em, candidate.line.accountId, scope)
  const targetAccountId = rule?.targetAccountId ?? settings.unallocatedCostAccountId ?? null
  if (!targetAccountId) {
    throw new CrudHttpError(422, {
      error: translate(
        'posting_rules.errors.noTargetAccountResolved',
        'No DefaultAccountPostingRule matches this account and PostingRulesSettings.unallocatedCostAccountId is not configured.',
      ),
    })
  }
  const explicitTag = await loadExplicitCostCenterTag(em, candidate.line.id, scope)
  const costCenterId =
    explicitTag ??
    (await activeCostCenterId(em, rule?.defaultCostCenterId, scope)) ??
    (await loadSentinelCostCenterId(em, scope, translate))
  return inverted
    ? { debitAccountId: clearingAccountId, creditAccountId: targetAccountId, clearingAccountId, costCenterId }
    : { debitAccountId: targetAccountId, creditAccountId: clearingAccountId, clearingAccountId, costCenterId }
}

/**
 * Finds the reclassification a contra-side line in a `REVERSAL` entry
 * should mirror — per line, not per entry (spec, Design Decisions,
 * "Reversals are mirrored, not duplicated"). From the reversal's
 * `referenceId` (the reversed entry) take that entry's lines on the same
 * account with the same amount on the opposite side, and pair them with the
 * reversal's own matching contra lines in a stable order (by line id on
 * both sides): the k-th reversal line mirrors the k-th original. #5663
 * records no per-line link between a reversal line and the line it
 * reverses, so for several identical account/amount lines carrying
 * different *explicit* tags the pairing can swap which cost centre a mirror
 * reuses; ledger totals are unaffected (disclosed in the spec).
 */
async function findOriginalReclassification(
  em: EntityManager,
  candidate: ReclassifyCandidate,
  clearingAccountId: string,
  scope: Scope,
): Promise<{ targetAccountId: string; targetLineId: string } | null> {
  const reversedEntryId = candidate.entry.referenceId
  if (!reversedEntryId) return null
  const { amount, side } = amountOf(candidate.line)

  const sameShape = (line: { accountId: string; debit: string; credit: string }, wantedSide: 'debit' | 'credit') => {
    const shape = amountOf(line)
    return line.accountId === candidate.line.accountId && shape.amount === amount && shape.side === wantedSide
  }
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const reversedLines = await em.find(JournalEntryLine, {
    journalEntryId: reversedEntryId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const originals = reversedLines.filter((line) => sameShape(line, side === 'debit' ? 'credit' : 'debit')).sort(byId)
  if (originals.length === 0) return null

  const reversalLines = await em.find(JournalEntryLine, {
    journalEntryId: candidate.entry.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const peers = reversalLines.filter((line) => sameShape(line, side)).sort(byId)
  const index = Math.max(0, peers.findIndex((line) => line.id === candidate.line.id))
  const original = originals[index]
  if (!original) return null

  const reclassification = await findReclassificationEntry(em, original.id, scope)
  if (!reclassification) return null
  const targetLine = await findTargetLine(em, reclassification.id, clearingAccountId, scope)
  return targetLine ? { targetAccountId: targetLine.accountId, targetLineId: targetLine.id } : null
}

/** A reclassification has exactly two lines; the target (zespół 5) line is
 * the one that is not on the clearing account. */
async function findTargetLine(
  em: EntityManager,
  reclassificationEntryId: string,
  clearingAccountId: string,
  scope: Scope,
): Promise<JournalEntryLine | null> {
  const lines = await em.find(JournalEntryLine, {
    journalEntryId: reclassificationEntryId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return lines.find((line) => line.accountId !== clearingAccountId) ?? null
}

/**
 * Posts the reclassification at most once per source line. Takes a
 * transaction-scoped advisory lock on the line id, re-checks the marker
 * inside the same transaction, and posts through `ctx.transactionalEm` so
 * the lock and the posting commit together — the same primitive
 * (`pg_advisory_xact_lock(hashtextextended(?, 0))`) `ledger`'s
 * `fiscalPeriods.ts` uses. A composed `postJournalEntry` call does not emit
 * `ledger.journal_entry.posted` itself (`isComposedPostingCall`), so this
 * emits it for the engine's own entry after the commit; the subscriber
 * ignores that event by the marker.
 */
async function postOncePerLine(
  deps: ReclassifyDeps,
  candidate: ReclassifyCandidate,
  plan: ResolvedPlan,
  description: string,
): Promise<{ journalEntryId: string; targetLineId: string | null; posted: boolean }> {
  const { container, em, scope } = deps
  const { amount } = amountOf(candidate.line)
  const amountCurrency = candidate.line.amountCurrency ?? '0'

  const postInput: PostJournalEntryInput = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    operationDate: new Date(candidate.entry.operationDate),
    description,
    currencyId: candidate.entry.currencyId,
    ...(candidate.entry.exchangeRate ? { exchangeRate: candidate.entry.exchangeRate } : {}),
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: candidate.line.id,
    lines: [
      { accountId: plan.debitAccountId, debit: amount, amountCurrency },
      { accountId: plan.creditAccountId, credit: amount, amountCurrency },
    ],
  }

  const outcome = await em.fork().transactional(async (trx) => {
    await trx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [candidate.line.id])
    const existing = await findReclassificationEntry(trx, candidate.line.id, scope)
    if (existing) return { journalEntryId: existing.id, result: null as PostJournalEntryResult | null }

    const commandBus = container.resolve<CommandBus>('commandBus')
    const ctx = buildCommandRuntimeContext(container, scope, trx)
    // `commandBus.execute` resolves `CommandExecuteResult<TResult>` (`{ result,
    // logEntry }`), never the bare command result — unwrap `.result` here.
    const executed = await commandBus.execute<PostJournalEntryInput, PostJournalEntryResult>('ledger.postJournalEntry', {
      input: postInput,
      ctx,
    })
    return { journalEntryId: executed.result.journalEntryId, result: executed.result }
  })

  if (!outcome.result) {
    const existingTarget = await findTargetLine(em, outcome.journalEntryId, plan.clearingAccountId, scope)
    return { journalEntryId: outcome.journalEntryId, targetLineId: existingTarget?.id ?? null, posted: false }
  }

  const { result } = outcome
  void emitLedgerEvent('ledger.journal_entry.posted', {
    journalEntryId: result.journalEntryId,
    sequenceNumber: result.sequenceNumber,
    type: 'NORMAL',
    operationDate: candidate.entry.operationDate,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    referenceType: RECLASSIFICATION_REFERENCE_TYPE,
    referenceId: candidate.line.id,
    lines: result.lines.map((line) => ({ id: line.id, accountId: line.accountId, debit: line.debit, credit: line.credit })),
  }).catch(() => undefined)

  const targetLine = result.lines.find((line) => line.accountId !== plan.clearingAccountId) ?? result.lines[0]
  return { journalEntryId: result.journalEntryId, targetLineId: targetLine?.id ?? null, posted: true }
}

/** Makes sure the reclassification's zespół 5 line carries a `CostCenter`
 * tag, whether or not this pass posted it: `setJournalEntryLineDimension`
 * runs in its own transaction, so a failure after the posting must be
 * repaired by the next pass, not by a second posting. Sets the tag only
 * when none exists. */
async function ensureTag(
  deps: ReclassifyDeps,
  targetLineId: string,
  resolveCostCenterId: () => Promise<string>,
): Promise<void> {
  const { container, em, scope } = deps
  const existing = await loadCostCenterTagsForLine(em, targetLineId, scope)
  if (existing.length > 0) return
  const costCenterId = await resolveCostCenterId()
  await tagCostCenter(buildCommandRuntimeContext(container, scope), container, scope, targetLineId, costCenterId)
}

/**
 * Reclassifies exactly one posted `JournalEntryLine` — the shared helper
 * behind the subscriber and `reconcileCostRing`. A line outside the source
 * set (entry type other than `NORMAL`/`REVERSAL`, the engine's own output,
 * a non-zespół-4 account, the clearing account) is a no-op, never an error.
 * Idempotent per source line: a line that already has its reclassification
 * only gets its tag ensured.
 */
export async function reclassifyLine(
  deps: ReclassifyDeps,
  candidate: ReclassifyCandidate,
): Promise<ReclassifyResult> {
  const { em, scope, translate } = deps

  // Source set, conditions 1 and 2 (spec, Design Decisions, "Which entries
  // and lines the engine reacts to"). Checked by the subscriber too, but
  // re-checked here so `reconcileCostRing` gets the same guarantee.
  if (!isTriggerEntryType(candidate.entry.type)) {
    return { reclassified: false, reason: 'not_in_trigger_set' }
  }
  if (candidate.entry.referenceType === RECLASSIFICATION_REFERENCE_TYPE) {
    return { reclassified: false, reason: 'already_engine_output' }
  }

  const { isZespol4, normalBalance } = await resolveAccountClassification(em, candidate.line.accountId, scope)
  if (!isZespol4 || !normalBalance) {
    return { reclassified: false, reason: 'not_zespol_4' }
  }

  const settings = await loadSettings(em, scope)
  const clearingAccountId = settings?.clearingAccountId ?? null
  if (!settings || !clearingAccountId) {
    throw new CrudHttpError(422, {
      error: translate(
        'posting_rules.errors.clearingAccountNotConfigured',
        'The technical clearing account (PostingRulesSettings.clearingAccountId) is not configured for this organization.',
      ),
    })
  }
  // Source set, condition 3: the clearing account is never a source. It
  // resolves to `code: '4'` like any other zespół 4 account, so without
  // this a closing entry, a manual adjustment or the reversal of one of the
  // engine's own reclassifications would enter the reclassification path.
  if (candidate.line.accountId === clearingAccountId) {
    return { reclassified: false, reason: 'clearing_account' }
  }

  const { side } = amountOf(candidate.line)
  const isNormalSide = side === (normalBalance === 'DEBIT' ? 'debit' : 'credit')

  // The plan for this line: the normal side resolves through the rule and the
  // hybrid; the contra side mirrors its original reclassification when there
  // is one (credit its target account, reuse its cost centre — Invariant 5,
  // point-in-time), and otherwise — a credit note, a 4xx→4xx reclassification,
  // a reversal whose original was never reclassified — resolves like a cost
  // and posts the inverted direction.
  const resolvePlan = async (): Promise<ResolvedPlan> => {
    if (isNormalSide) return resolveRulePlan(deps, candidate, settings, false)
    const original =
      candidate.entry.type === 'REVERSAL'
        ? await findOriginalReclassification(em, candidate, clearingAccountId, scope)
        : null
    if (!original) return resolveRulePlan(deps, candidate, settings, true)
    const reused =
      (await loadCostCenterTagsForLine(em, original.targetLineId, scope))[0] ?? (await loadSentinelCostCenterId(em, scope, translate))
    return { debitAccountId: clearingAccountId, creditAccountId: original.targetAccountId, clearingAccountId, costCenterId: reused }
  }

  // Already reclassified: nothing to post, only make sure the tag exists.
  // Checked before resolving a plan so that a rule deleted after posting
  // cannot turn an idempotent re-delivery into an error; the plan is
  // resolved only if the tag is actually missing, and then the same way as
  // for a first pass (a mirror re-reads its original's cost centre).
  const existing = await findReclassificationEntry(em, candidate.line.id, scope)
  if (existing) {
    const targetLine = await findTargetLine(em, existing.id, clearingAccountId, scope)
    if (targetLine) {
      await ensureTag(deps, targetLine.id, async () => (await resolvePlan()).costCenterId)
    }
    return { reclassified: false, reason: 'already_reclassified' }
  }

  const plan = await resolvePlan()
  const description = translate(
    'posting_rules.reclassification.description',
    'Automatic zespół 4→5 cost reclassification of entry #{entryId}',
    { entryId: candidate.entry.id },
  )

  const posted = await postOncePerLine(deps, candidate, plan, description)
  if (posted.targetLineId) {
    await ensureTag(deps, posted.targetLineId, async () => plan.costCenterId)
  }
  return posted.posted ? { reclassified: true, journalEntryId: posted.journalEntryId } : { reclassified: false, reason: 'already_reclassified' }
}
