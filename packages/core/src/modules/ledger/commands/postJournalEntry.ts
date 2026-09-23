// =============================================================================
// Ledger Posting Commands — Undo Policy
// =============================================================================
//
// `postJournalEntry` and `reverseJournalEntry` are deliberately registered
// with `isUndoable: false` and implement neither `undo` nor `redo`. Per this
// module's own design
// (`.ai/specs/2026-08-18-general-ledger-core-engine.md` § Design decisions,
// "Corrections are reversals, not undo"): a posted `JournalEntry` is an
// append-only, immutable accounting record whose `sequenceNumber` is
// consecutively allocated (art. 14 ust. 2 Ustawy o rachunkowości). Undoing a
// post by deleting or mutating it after the fact would silently break that
// numbering guarantee for every entry posted after it. The correct way to
// back out a mistaken post is the domain's own explicit counter-action —
// `reverseJournalEntry` — which posts a new, separately numbered `REVERSAL`
// entry with inverted lines. That reversal is itself just another immutable
// posted entry, fully auditable through the normal journal, never a
// generic "undo" of the original.
// =============================================================================

import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount, type JournalEntryType } from '../data/entities'
import { postJournalEntrySchema, type PostJournalEntryInput } from '../data/validators'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { emitLedgerEvent } from '../events'

export type PostJournalEntryResult = { journalEntryId: string; sequenceNumber: number }

type Scope = { organizationId: string; tenantId: string }

type TranslateFn = (key: string, fallback: string, params?: Record<string, unknown>) => string
// Widened from the original (key, fallback) => string: resolveTranslations()'s
// translate() is really a TranslateWithFallbackFn (see
// packages/shared/src/lib/i18n/translate.ts) and already supports a params
// bag for {placeholder} interpolation — requireValidPostingReferences (M5)
// is this file's first caller that needs it.

/**
 * Detects the deferred `journal_entry_line_balanced` constraint trigger
 * (see migrations) firing at commit — a plain Postgres exception (SQLSTATE
 * P0001), not a constraint-name-bearing violation like
 * `isUniqueViolation` checks for. This is the last-resort integrity guard:
 * application-layer validation (`postJournalEntrySchema`'s balance refine)
 * should make this unreachable in normal operation, but the spec requires
 * `postJournalEntry` to translate a trigger failure into a readable
 * application error rather than let the raw DB exception reach the caller.
 */
function isBalanceTriggerViolation(err: unknown): boolean {
  const candidates: unknown[] = [err, (err as { cause?: unknown } | null)?.cause, (err as { previous?: unknown } | null)?.previous]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const message = typeof (candidate as { message?: unknown }).message === 'string' ? (candidate as { message: string }).message : ''
    if (message.includes('journal_entry_line: unbalanced')) return true
  }
  return false
}

/**
 * Atomically allocates the next `JournalEntrySequence.nextValue` for
 * `(organizationId, tenantId)`, inside the caller's transaction, via the
 * same `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` shape
 * `sales/services/salesDocumentNumberGenerator.ts` uses for
 * `SalesDocumentSequence` (see Design decisions — this module's own
 * `JournalEntrySequence` is modeled identically, corrected 2026-09-18).
 * Placeholders use `?` (knex-style) to match this repo's other raw-SQL
 * call sites; the spec's own quoted SQL uses native `$1`/`$2`
 * placeholders, translated here for consistency.
 *
 * Uses `em.execute(...)` — never `em.getConnection().execute(...)`.
 * `SqlEntityManager.execute` resolves `context.getTransactionContext()`
 * and forwards it as the connection's `ctx` argument, so the statement
 * joins whatever transaction `em` is currently inside. Going through
 * `getConnection().execute(sql, params)` directly skips that resolution
 * (its `ctx` parameter is left `undefined`), so the statement runs and
 * commits on the raw pool client immediately — independently of the
 * caller's transaction. A post that later fails validation, hits the
 * deferred balance trigger at commit, or is inside a caller's outer
 * transaction that rolls back would still have burned a sequence number,
 * breaking the gap-free numbering this module promises (art. 14 ust. 2
 * Ustawy o rachunkowości). Fixed 2026-09-23 per PR #6340 review, M2.
 */
async function claimNextSequenceNumber(em: EntityManager, scope: Scope): Promise<number> {
  const rows = await em.execute<{ next_value: string }[]>(
    `
      insert into journal_entry_sequence (id, organization_id, tenant_id, next_value, created_at)
      values (gen_random_uuid(), ?, ?, 2, now())
      on conflict (organization_id, tenant_id)
      do update set next_value = journal_entry_sequence.next_value + 1
      returning next_value - 1 as next_value
    `,
    [scope.organizationId, scope.tenantId],
  )
  const value = Number(rows?.[0]?.next_value)
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('ledger: failed to allocate the next journal entry sequence number')
  }
  return value
}

/**
 * Rejects a post before any write when no `FiscalPeriod` covers
 * `operationDate` at all, or when the covering period `isLocked`. Keyed on
 * `operationDate` (the business event date, art. 20 ust. 1 UoR) — never
 * `postedAt` (corrected 2026-09-18, see Design decisions).
 *
 * Reads the covering period with `PESSIMISTIC_READ` (`for share`), always
 * called from inside `withPostingTransaction`'s transaction. Without this,
 * under READ COMMITTED, a post that reads the period as "unlocked" can
 * still commit after a concurrent `lockFiscalPeriod` commits — a posting
 * lands in a period an operator believed was already closed (PR #6340
 * review, M4). `for share` (not `for update`) is enough here: posting
 * doesn't need to block other concurrent posts against the same period,
 * only to block a concurrent lock/unlock of it — `toggleFiscalPeriodLock`
 * takes the conflicting `for update` lock (see fiscalPeriods.ts).
 */
async function requireCoveringUnlockedFiscalPeriod(
  em: EntityManager,
  scope: Scope,
  operationDate: Date,
  translate: TranslateFn,
): Promise<void> {
  const period = await em.findOne(
    FiscalPeriod,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      startDate: { $lte: operationDate },
      endDate: { $gte: operationDate },
    },
    { lockMode: LockMode.PESSIMISTIC_READ },
  )
  if (!period) {
    throw new CrudHttpError(422, {
      error: translate(
        'ledger.errors.noFiscalPeriodForOperationDate',
        'No fiscal period covers this operation date. Create one before posting.',
      ),
    })
  }
  if (period.isLocked) {
    throw new CrudHttpError(422, {
      error: translate(
        'ledger.errors.fiscalPeriodLocked',
        'The fiscal period covering this operation date is locked.',
      ),
    })
  }
}

/**
 * The shared posting core's input shape. Structurally a superset of
 * `PostJournalEntryInput` (same fields; `type` widened to the full
 * `JournalEntryType` union) so `reverseJournalEntry` can post a
 * `REVERSAL`-typed entry through the exact same validated path —
 * `postJournalEntrySchema` deliberately restricts `type` to
 * `NORMAL | OPENING | CLOSING` for *callers* of `postJournalEntry` itself;
 * `REVERSAL` is never caller-supplied there.
 */
export type JournalEntryPostCore = {
  organizationId: string
  tenantId: string
  operationDate: Date
  documentType?: string | null
  documentNumber?: string | null
  documentDate?: Date | null
  description: string
  type?: JournalEntryType
  currencyId: string
  exchangeRate?: string | null
  referenceType?: string | null
  referenceId?: string | null
  lines: {
    accountId: string
    debit?: string
    credit?: string
    amountCurrency?: string
    contractorSnapshot?: Record<string, unknown> | null
  }[]
}

type PostRunResult = PostJournalEntryResult & { lines: JournalEntryLine[] }

/**
 * The shared posting core: validates the covering period, allocates the
 * sequence number, and persists a balanced entry + lines in one
 * transaction. Exported (not just used by `execute` below) so
 * `reverseJournalEntry` can post its `REVERSAL` entry through the exact
 * same validated path instead of duplicating it.
 */
/**
 * Rejects a post whose `currencyId` or any line's `accountId` doesn't
 * exist, is soft-deleted, or belongs to a different organization/tenant
 * (PR #6340 review, M5). Without this, lines were persisted pointing at
 * deleted accounts or another tenant's account id, with no FK to catch it
 * — and the delete-once-posted guards in `ledgerAccounts.ts` could be
 * bypassed after the fact by posting against an account id that was never
 * real to begin with. Runs before `claimNextSequenceNumber`, so a request
 * that fails this check never burns a sequence number.
 */
async function requireValidPostingReferences(
  em: EntityManager,
  scope: Scope,
  input: JournalEntryPostCore,
  translate: TranslateFn,
): Promise<void> {
  const currency = await em.findOne(Currency, {
    id: input.currencyId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!currency) {
    throw new CrudHttpError(422, {
      error: translate('ledger.errors.currencyNotFound', 'The specified currency does not exist for this organization.'),
    })
  }

  const accountIds = [...new Set(input.lines.map((line) => line.accountId))]
  const accounts = await em.find(LedgerAccount, {
    id: { $in: accountIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  const foundIds = new Set(accounts.map((account) => account.id))
  const missing = accountIds.filter((id) => !foundIds.has(id))
  if (missing.length > 0) {
    throw new CrudHttpError(422, {
      error: translate(
        'ledger.errors.accountNotFound',
        'One or more journal entry lines reference an account that does not exist for this organization: {ids}.',
        { ids: missing.join(', ') },
      ),
    })
  }
}

export async function runPostJournalEntry(
  em: EntityManager,
  input: JournalEntryPostCore,
  translate: TranslateFn,
): Promise<PostRunResult> {
  const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }
  await requireCoveringUnlockedFiscalPeriod(em, scope, input.operationDate, translate)
  await requireValidPostingReferences(em, scope, input, translate)

  const sequenceNumber = await claimNextSequenceNumber(em, scope)
  const entryId = randomUUID()
  const entry = em.create(JournalEntry, {
    id: entryId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    sequenceNumber,
    postedAt: new Date(),
    operationDate: input.operationDate,
    documentType: input.documentType ?? null,
    documentNumber: input.documentNumber ?? null,
    documentDate: input.documentDate ?? null,
    description: input.description,
    type: input.type ?? 'NORMAL',
    currencyId: input.currencyId,
    exchangeRate: input.exchangeRate ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
  })
  em.persist(entry)

  const lines = input.lines.map((line) =>
    em.create(JournalEntryLine, {
      id: randomUUID(),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      journalEntryId: entryId,
      accountId: line.accountId,
      debit: line.debit ?? '0',
      credit: line.credit ?? '0',
      amountCurrency: line.amountCurrency ?? '0',
      contractorSnapshot: line.contractorSnapshot ?? null,
    }),
  )
  lines.forEach((line) => em.persist(line))

  try {
    await em.flush()
    // `journal_entry_line_balanced` is `deferrable initially deferred`, so
    // it fires at COMMIT, not at `flush()` — the try/catch below never saw
    // it, and the raw, untranslated Postgres error reached the caller (PR
    // #6340 review, m5). Forcing the deferred check to run now, still
    // inside this transaction and still inside this try, makes it
    // catchable here instead of escaping past `withPostingTransaction`'s
    // commit.
    await em.execute('set constraints "journal_entry_line_balanced" immediate')
  } catch (err) {
    if (isBalanceTriggerViolation(err)) {
      throw new CrudHttpError(500, {
        error: translate(
          'ledger.errors.unbalancedEntryRejectedAtCommit',
          'The journal entry was rejected at commit because it is not balanced. This should never happen when application validation ran — please report this.',
        ),
      })
    }
    throw err
  }

  return { journalEntryId: entryId, sequenceNumber, lines }
}

/**
 * Runs `operation` inside `ctx.transactionalEm` when the caller already
 * supplied one (so e.g. Accounts Payable's `postVendorInvoice` can compose
 * its own write and this posting into one atomic, single-locked
 * transaction — see `CommandRuntimeContext.transactionalEm`), otherwise
 * opens a fresh transaction on a forked EntityManager. Mirrors
 * `sales/commands/documents.ts`'s quote-to-order conversion pattern.
 */
export async function withPostingTransaction<T>(
  ctx: CommandRuntimeContext,
  operation: (em: EntityManager) => Promise<T>,
): Promise<T> {
  const callerEm = ctx.transactionalEm
  if (callerEm) return operation(callerEm)
  const rootEm = (ctx.container.resolve('em') as EntityManager).fork()
  return rootEm.transactional((trx) => operation(trx))
}

/**
 * Whether `ctx` composed this call inside a caller-supplied transaction
 * (`ctx.transactionalEm`, e.g. Accounts Payable's `postVendorInvoice`
 * wrapping its own write and this posting into one atomic transaction) —
 * as opposed to `withPostingTransaction` opening and fully committing its
 * own fresh transaction. `postJournalEntryCommand`/
 * `reverseJournalEntryCommand` use this to decide whether it's safe to
 * emit `ledger.journal_entry.posted` right after `withPostingTransaction`
 * returns: when composed, that caller's outer transaction is still open at
 * that point, so emitting here would fire the event before the write is
 * actually durable, and a subsequent rollback would leave subscribers
 * having reacted to a posting and sequence number that never happened (PR
 * #6340 review, M7). In the composed case, the caller becomes responsible
 * for emitting the event itself, after its own commit.
 */
export function isComposedPostingCall(ctx: CommandRuntimeContext): boolean {
  return Boolean(ctx.transactionalEm)
}

async function emitPostedEvent(input: JournalEntryPostCore, result: PostRunResult): Promise<void> {
  await emitLedgerEvent('ledger.journal_entry.posted', {
    journalEntryId: result.journalEntryId,
    sequenceNumber: result.sequenceNumber,
    type: input.type ?? 'NORMAL',
    operationDate: input.operationDate.toISOString().slice(0, 10),
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    lines: result.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
    })),
  })
}

const postJournalEntryCommand: CommandHandler<PostJournalEntryInput, PostJournalEntryResult> = {
  id: 'ledger.postJournalEntry',
  // See "Ledger Posting Commands — Undo Policy" at the top of this file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = postJournalEntrySchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const { translate } = await resolveTranslations()
    const result = await withPostingTransaction(ctx, (em) => runPostJournalEntry(em, input, translate))

    // Emitted after commit, per the spec — this is the only way another
    // module (e.g. Posting Rules Engine) may react to a posting. Only
    // fired here when this call opened (and therefore already fully
    // committed) its own transaction — see isComposedPostingCall's doc
    // comment. A composing caller (ctx.transactionalEm set) must emit this
    // event itself once its own outer transaction commits.
    if (!isComposedPostingCall(ctx)) {
      void emitPostedEvent(input, result).catch(() => undefined)
    }

    return { journalEntryId: result.journalEntryId, sequenceNumber: result.sequenceNumber }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.postJournalEntry', 'Post journal entry'),
      resourceKind: 'ledger.journal_entry',
      resourceId: result.journalEntryId,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: { sequenceNumber: result.sequenceNumber },
    }
  },
}

registerCommand(postJournalEntryCommand)
