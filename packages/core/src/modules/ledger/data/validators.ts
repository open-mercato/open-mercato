import { z } from 'zod'

// Numeric columns backing `debit`/`credit`/`amount_currency` are
// `numeric(19,4)` — matches `JournalEntryLine`'s own column precision
// (see data/entities.ts).
const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a non-negative decimal with at most 4 decimal places.')

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
      const debit = Number(line.debit ?? '0')
      const credit = Number(line.credit ?? '0')
      return (debit === 0 || credit === 0) && (debit > 0 || credit > 0)
    },
    { message: 'Each journal entry line must have exactly one side (debit or credit) greater than zero.' },
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
      .regex(/^\d+(\.\d{1,8})?$/, 'Exchange rate must be a non-negative decimal with at most 8 decimal places.')
      .nullable()
      .optional(),
    referenceType: z.string().max(100).nullable().optional(),
    referenceId: z.uuid().nullable().optional(),
    lines: z.array(journalEntryLineInputSchema).min(2, 'A journal entry requires at least two lines.'),
  })
  .refine(
    (data) => {
      const totalDebit = data.lines.reduce((sum, line) => sum + Number(line.debit ?? '0'), 0)
      const totalCredit = data.lines.reduce((sum, line) => sum + Number(line.credit ?? '0'), 0)
      return Math.abs(totalDebit - totalCredit) < 0.00005
    },
    { message: 'Journal entry is not balanced: total debits must equal total credits.', path: ['lines'] },
  )

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
