// See "Ledger Posting Commands — Undo Policy" at the top of
// `commands/postJournalEntry.ts` — this command is the domain's own
// counter-action to a mistaken post, not a generic undo, and (like
// `postJournalEntry`) is registered with `isUndoable: false`.

import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { JournalEntry, JournalEntryLine } from '../data/entities'
import { reverseJournalEntrySchema, type ReverseJournalEntryInput } from '../data/validators'
import { runPostJournalEntry, withPostingTransaction, type JournalEntryPostCore, type PostJournalEntryResult } from './postJournalEntry'
import { emitLedgerEvent } from '../events'

type Scope = { organizationId: string; tenantId: string }

/**
 * Loads the original entry and its lines, scoped to the caller's
 * organization/tenant — a `reverseJournalEntry` call cannot reach across
 * scopes any more than any other command can.
 */
async function loadOriginalEntry(
  em: EntityManager,
  journalEntryId: string,
  scope: Scope,
): Promise<{ entry: JournalEntry; lines: JournalEntryLine[] }> {
  const entry = await em.findOne(JournalEntry, {
    id: journalEntryId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!entry) throw notFound('Journal entry not found.')
  const lines = await em.find(JournalEntryLine, {
    journalEntryId: entry.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return { entry, lines }
}

/**
 * Builds the `REVERSAL` entry's input from the original: every line's
 * `debit`/`credit` swapped (inverting the entry without mutating the
 * original — the original is never persisted to or written back to here),
 * same `accountId`/`amountCurrency`/`contractorSnapshot` per line, same
 * `currencyId`/`exchangeRate` as the original (a reversal restates the same
 * economic event in the same currency). `referenceType`/`referenceId` link
 * back to the original entry — this module has no dedicated
 * "reversalOf"-style column (not in the Data Model), so this reuses the
 * entity's existing generic FK-pointer mechanism, disclosed here as a
 * deliberate, spec-unspecified choice rather than an invented column.
 * `operationDate` is always the caller's own (never the original's) — see
 * Design decisions, "a reversal exists to move a correction into an open
 * period."
 */
function buildReversalCore(
  original: JournalEntry,
  originalLines: JournalEntryLine[],
  input: ReverseJournalEntryInput,
  translate: (key: string, fallback: string, vars?: Record<string, unknown>) => string,
): JournalEntryPostCore {
  return {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    operationDate: input.operationDate,
    documentType: input.documentType ?? null,
    documentNumber: input.documentNumber ?? null,
    documentDate: input.documentDate ?? null,
    description:
      input.description ??
      translate(
        'ledger.reversal.defaultDescription',
        `Reversal of journal entry #${original.sequenceNumber}`,
        { sequenceNumber: original.sequenceNumber },
      ),
    type: 'REVERSAL',
    currencyId: original.currencyId,
    exchangeRate: original.exchangeRate ?? null,
    referenceType: 'journal_entry',
    referenceId: original.id,
    lines: originalLines.map((line) => ({
      accountId: line.accountId,
      // Inverted: the original's debit becomes the reversal's credit and
      // vice versa. Never both populated on the same line (mirrors the
      // original, which already satisfies the one-sided constraint).
      debit: line.credit,
      credit: line.debit,
      amountCurrency: line.amountCurrency,
      contractorSnapshot: line.contractorSnapshot ?? null,
    })),
  }
}

const reverseJournalEntryCommand: CommandHandler<ReverseJournalEntryInput, PostJournalEntryResult> = {
  id: 'ledger.reverseJournalEntry',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = reverseJournalEntrySchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const { translate } = await resolveTranslations()
    const scope: Scope = { organizationId: input.organizationId, tenantId: input.tenantId }

    const result = await withPostingTransaction(ctx, async (em) => {
      const { entry: original, lines: originalLines } = await loadOriginalEntry(em, input.journalEntryId, scope)
      const core = buildReversalCore(original, originalLines, input, translate)
      // Reuses `postJournalEntry`'s own validated path — same fiscal-period
      // lock check (against the reversal's own `operationDate`), same
      // atomic sequence allocation, same balanced-entry persistence.
      return runPostJournalEntry(em, core, translate)
    })

    // Corrected 2026-09-14 in the spec: `reverseJournalEntry` also emits
    // `ledger.journal_entry.posted` after commit, exactly like
    // `postJournalEntry` — a downstream subscriber (e.g. Posting Rules
    // Engine's reversal-mirroring subscriber) must see the REVERSAL entry
    // the same way it sees any other posted entry.
    void emitLedgerEvent('ledger.journal_entry.posted', {
      journalEntryId: result.journalEntryId,
      sequenceNumber: result.sequenceNumber,
      type: 'REVERSAL',
      operationDate: input.operationDate.toISOString().slice(0, 10),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      referenceType: 'journal_entry',
      referenceId: input.journalEntryId,
      lines: result.lines.map((line) => ({
        id: line.id,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
      })),
    }).catch(() => undefined)

    return { journalEntryId: result.journalEntryId, sequenceNumber: result.sequenceNumber }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('ledger.audit.reverseJournalEntry', 'Reverse journal entry'),
      resourceKind: 'ledger.journal_entry',
      resourceId: result.journalEntryId,
      relatedResourceKind: 'ledger.journal_entry',
      relatedResourceId: input?.journalEntryId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: { sequenceNumber: result.sequenceNumber, reversedEntryId: input?.journalEntryId ?? null },
    }
  },
}

registerCommand(reverseJournalEntryCommand)
