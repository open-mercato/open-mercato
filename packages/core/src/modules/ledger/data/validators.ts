import { z } from 'zod'

// Numeric columns backing `debit`/`credit`/`amount_currency` are
// `numeric(19,4)` — matches `JournalEntryLine`'s own column precision
// (see data/entities.ts).
// PR #6340 review, m1 (residual): this was `.regex(pattern, 'message')` —
// zod's built-in format checks (regex/uuid/min/max/...) don't carry a
// `params` bag onto their issue the way `.refine()`'s custom issues do
// (confirmed by direct testing: `params` passed to `.regex()`'s object-form
// message config is silently dropped from the resulting issue), so there
// was no hook for `translateZodIssues` (see crud/factory.ts) to translate
// through. Rewritten as an equivalent `.refine()` — same regex, same
// pass/fail behavior — specifically to gain that hook; this is the
// "amount"/"exchange rate" residual the review called out by line number
// (validators.ts:8) alongside the three `.refine()` messages already
// covered.
const MONEY_PATTERN = /^\d+(\.\d{1,4})?$/
const moneyStringSchema = z.string().refine((value) => MONEY_PATTERN.test(value), {
  message: 'Amount must be a non-negative decimal with at most 4 decimal places.',
  params: {
    i18nKey: 'ledger.errors.amountInvalidFormat',
    i18nFallback: 'Amount must be a non-negative decimal with at most 4 decimal places.',
  },
})

// Converts a `moneyStringSchema`-shaped decimal string (non-negative, at
// most 4 fractional digits) to an exact integer count of ten-thousandths,
// for balance comparisons. `Number(...)` loses precision once a sum
// approaches 1e13 (0.0001 falls below double precision there), so an
// unbalanced entry could otherwise pass this check and only be caught by
// the DB trigger (PR #6340 review, m7) — BigInt arithmetic has no such
// ceiling.
function toMinorUnits(amount: string | undefined): bigint {
  if (!amount) return 0n
  const [whole, fraction = ''] = amount.split('.')
  const paddedFraction = `${fraction}0000`.slice(0, 4)
  return BigInt(whole) * 10000n + BigInt(paddedFraction)
}

// One line of a journal entry. Mirrors the DB's
// `journal_entry_line_one_sided_chk` check constraint at the application
// layer (see migrations) — exactly one of `debit`/`credit` may be
// positive, never both, never neither.
export const journalEntryLineInputSchema = z
  .object({
    accountId: z.uuid(),
    debit: moneyStringSchema.optional(),
    credit: moneyStringSchema.optional(),
    amountCurrency: moneyStringSchema.optional(),
    contractorSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine(
    (line) => {
      const debit = toMinorUnits(line.debit)
      const credit = toMinorUnits(line.credit)
      return (debit === 0n || credit === 0n) && (debit > 0n || credit > 0n)
    },
    {
      message: 'Each journal entry line must have exactly one side (debit or credit) greater than zero.',
      // PR #6340 review, m1: `params.i18nKey`/`i18nFallback` is the new
      // opt-in convention (see `translateZodIssues` in
      // packages/shared/src/lib/crud/factory.ts) for routing a `.refine()`
      // message through `translate()` before it reaches the client — this
      // schema's business-rule messages are the first real usage.
      params: { i18nKey: 'ledger.errors.journalEntryLineNotOneSided', i18nFallback: 'Each journal entry line must have exactly one side (debit or credit) greater than zero.' },
    },
  )

// `postJournalEntry` input. `type` excludes `REVERSAL` — that value is
// reserved for `reverseJournalEntry`'s own internal construction and is
// never accepted from a caller of `postJournalEntry` (see
// reverseJournalEntrySchema / commands/reverseJournalEntry.ts).
export const postJournalEntrySchema = z
  .object({
    organizationId: z.uuid(),
    tenantId: z.uuid(),
    // Art. 23 ust. 2 Ustawy o rachunkowości — required on every entry (see
    // Design decisions). Server-sets `postedAt`; the caller never supplies it.
    operationDate: z.coerce.date(),
    documentType: z.string().max(100).nullable().optional(),
    documentNumber: z.string().max(200).nullable().optional(),
    documentDate: z.coerce.date().nullable().optional(),
    description: z.string().min(1).max(1000),
    type: z.enum(['NORMAL', 'OPENING', 'CLOSING']).optional(),
    currencyId: z.uuid(),
    exchangeRate: z
      .string()
      // Same rewrite as `moneyStringSchema` above, same reason (m1 residual).
      .refine((value) => /^\d+(\.\d{1,8})?$/.test(value), {
        message: 'Exchange rate must be a non-negative decimal with at most 8 decimal places.',
        params: {
          i18nKey: 'ledger.errors.exchangeRateInvalidFormat',
          i18nFallback: 'Exchange rate must be a non-negative decimal with at most 8 decimal places.',
        },
      })
      .nullable()
      .optional(),
    // PR #6340 review, n3: `'journal_entry'` is the internal marker value
    // `reverseJournalEntry.ts`'s `buildReversalCore` writes into a REVERSAL
    // entry's own `referenceType` to point back at the entry it reverses,
    // and it's what the double-reversal guard (the
    // `journal_entries_single_reversal_idx` partial unique index, plus the
    // `existingReversal` lookup in `loadOriginalEntry`) matches on. Without
    // this restriction, an external `postJournalEntry` caller could set
    // `referenceType: 'journal_entry', referenceId: <someEntryId>` on an
    // ordinary NORMAL/OPENING/CLOSING entry, poisoning that guard and making
    // `<someEntryId>` look "already reversed" — blocking its real reversal.
    // Rejected here, at the only schema external callers go through
    // (`reverseJournalEntry`'s own construction calls `runPostJournalEntry`
    // directly with a `JournalEntryPostCore`, bypassing this schema
    // entirely, so it's unaffected). The DB-level predicate and the
    // `existingReversal` lookup are additionally tightened to require
    // `type = 'REVERSAL'`, closing the same loophole in depth rather than
    // relying on this check alone.
    referenceType: z.string().max(100).nullable().optional(),
    referenceId: z.uuid().nullable().optional(),
    lines: z.array(journalEntryLineInputSchema).min(2, 'A journal entry requires at least two lines.'),
  })
  .refine(
    (data) => {
      const totalDebit = data.lines.reduce((sum, line) => sum + toMinorUnits(line.debit), 0n)
      const totalCredit = data.lines.reduce((sum, line) => sum + toMinorUnits(line.credit), 0n)
      return totalDebit === totalCredit
    },
    {
      message: 'Journal entry is not balanced: total debits must equal total credits.',
      path: ['lines'],
      params: { i18nKey: 'ledger.errors.journalEntryNotBalanced', i18nFallback: 'Journal entry is not balanced: total debits must equal total credits.' },
    },
  )
  .refine((data) => data.referenceType !== 'journal_entry', {
    message: "referenceType 'journal_entry' is reserved for reversal entries and cannot be set directly.",
    path: ['referenceType'],
    params: {
      i18nKey: 'ledger.errors.referenceTypeReserved',
      i18nFallback: "referenceType 'journal_entry' is reserved for reversal entries and cannot be set directly.",
    },
  })

export type JournalEntryLineInput = z.infer<typeof journalEntryLineInputSchema>
export type PostJournalEntryInput = z.infer<typeof postJournalEntrySchema>

// `reverseJournalEntry` input. The reversal's own `operationDate` is
// caller-supplied and deliberately independent of the original entry's —
// tying it to the original's (possibly closed) `operationDate` would defeat
// the mechanism a reversal exists for: moving a correction into an open
// period (see Design decisions, "corrected 2026-09-18").
export const reverseJournalEntrySchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  journalEntryId: z.uuid(),
  operationDate: z.coerce.date(),
  description: z.string().min(1).max(1000).optional(),
  documentType: z.string().max(100).nullable().optional(),
  documentNumber: z.string().max(200).nullable().optional(),
  documentDate: z.coerce.date().nullable().optional(),
})

export type ReverseJournalEntryInput = z.infer<typeof reverseJournalEntrySchema>


// `createFiscalPeriod` input. `isLocked` is never settable on create — it
// always starts `false` (see API Contracts).
export const createFiscalPeriodSchema = z
  .object({
    organizationId: z.uuid(),
    tenantId: z.uuid(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate.getTime() >= data.startDate.getTime(), {
    message: 'endDate must not be before startDate.',
    path: ['endDate'],
    params: { i18nKey: 'ledger.errors.fiscalPeriodEndBeforeStart', i18nFallback: 'endDate must not be before startDate.' },
  })

export type CreateFiscalPeriodInput = z.infer<typeof createFiscalPeriodSchema>

// `lockFiscalPeriod` / `unlockFiscalPeriod` input. The expected `updatedAt`
// version is not a schema field — per the spec it travels as the
// `x-om-ext-optimistic-lock-expected-updated-at` request header, read by
// `enforceCommandOptimisticLockWithGuards` (see commands/fiscalPeriods.ts).
export const lockFiscalPeriodSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export type LockFiscalPeriodInput = z.infer<typeof lockFiscalPeriodSchema>

export const unlockFiscalPeriodSchema = lockFiscalPeriodSchema
export type UnlockFiscalPeriodInput = z.infer<typeof unlockFiscalPeriodSchema>


// `createLedgerAccount` / `updateLedgerAccount` input.
export const ledgerAccountCreateSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  slug: z.string().min(1).max(100),
  accountTypeId: z.uuid(),
  parentAccountId: z.uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
})

export type LedgerAccountCreateInput = z.infer<typeof ledgerAccountCreateSchema>

export const ledgerAccountUpdateSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  slug: z.string().min(1).max(100).optional(),
  // Immutable once the account has posted entries — enforced at the
  // command layer (commands/ledgerAccounts.ts), not by this schema.
  accountTypeId: z.uuid().optional(),
  parentAccountId: z.uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
})

export type LedgerAccountUpdateInput = z.infer<typeof ledgerAccountUpdateSchema>

// `deleteLedgerAccount` input. Soft-delete only (`deletedAt`); blocked at
// the command layer when the account has posted entries (see
// commands/ledgerAccounts.ts).
export const ledgerAccountDeleteSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
})

export type LedgerAccountDeleteInput = z.infer<typeof ledgerAccountDeleteSchema>

// `createLedgerAccountType` / `updateLedgerAccountType` input.
export const ledgerAccountTypeCreateSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  parentAccountTypeId: z.uuid().nullable().optional(),
  accountGroupId: z.uuid().nullable().optional(),
})

export type LedgerAccountTypeCreateInput = z.infer<typeof ledgerAccountTypeCreateSchema>

export const ledgerAccountTypeUpdateSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  slug: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200).optional(),
  // Immutable (together with accountGroupId) once any account of this type
  // has posted entries — enforced at the command layer
  // (commands/ledgerAccountTypes.ts), not by this schema.
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
  parentAccountTypeId: z.uuid().nullable().optional(),
  accountGroupId: z.uuid().nullable().optional(),
})

export type LedgerAccountTypeUpdateInput = z.infer<typeof ledgerAccountTypeUpdateSchema>

// `deleteLedgerAccountType` input. Soft-delete only; blocked at the
// command layer when any account of this type has posted entries, or when
// another account type still names this one as its `parentAccountTypeId`
// (see commands/ledgerAccountTypes.ts).
export const ledgerAccountTypeDeleteSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
})

export type LedgerAccountTypeDeleteInput = z.infer<typeof ledgerAccountTypeDeleteSchema>
