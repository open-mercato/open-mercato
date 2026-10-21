import { z } from 'zod'
import {
  ACCOUNT_CLASSES,
  CASH_ACCOUNT_KINDS,
  JOURNAL_ENTRY_TYPES,
  NORMAL_BALANCES,
  PAYMENT_METHOD_KINDS,
} from './entities'
import { FinancialRuleError } from '../lib/errors'
import { assertJournalEntryRules, type JournalLineDraft } from '../lib/glService'

const amountField = z.union([z.string().trim().min(1), z.number()])

export const journalLineInputSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().trim().max(500).optional().nullable(),
  debitAmount: amountField.optional(),
  creditAmount: amountField.optional(),
  taxCode: z.string().trim().max(40).optional().nullable(),
})

const journalLinesSchema = z.array(journalLineInputSchema).min(2)

type JournalLinesInput = z.infer<typeof journalLinesSchema>

function toDrafts(lines: JournalLinesInput): JournalLineDraft[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitAmount: line.debitAmount ?? '0',
    creditAmount: line.creditAmount ?? '0',
    description: line.description ?? null,
    taxCode: line.taxCode ?? null,
  }))
}

function checkLines(lines: JournalLinesInput, ctx: z.RefinementCtx): void {
  try {
    assertJournalEntryRules(toDrafts(lines))
  } catch (error) {
    if (error instanceof FinancialRuleError) {
      ctx.addIssue({ code: 'custom', message: error.code, path: ['lines'] })
      return
    }
    throw error
  }
}

export const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  accountClass: z.enum(ACCOUNT_CLASSES),
  accountType: z.string().trim().max(50).optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  currencyCode: z.string().trim().length(3),
  normalBalance: z.enum(NORMAL_BALANCES),
  isActive: z.boolean().optional(),
  isReconciliationRequired: z.boolean().optional(),
  countryCode: z.string().trim().length(2).optional().nullable(),
})

export const updateAccountSchema = createAccountSchema.partial().extend({
  id: z.string().uuid(),
})

export const createPeriodSchema = z
  .object({
    fiscalYear: z.coerce.number().int().min(1900).max(3000),
    periodNumber: z.coerce.number().int().min(1).max(13),
    periodName: z.string().trim().min(1).max(50),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'endDate must not be before startDate',
    path: ['endDate'],
  })

export const updatePeriodSchema = z.object({
  id: z.string().uuid(),
  periodName: z.string().trim().min(1).max(50).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
})

export const createJournalEntrySchema = z
  .object({
    entryNumber: z.string().trim().min(1).max(50),
    entryDate: z.string().min(1),
    postingDate: z.string().min(1),
    periodId: z.string().uuid(),
    entryType: z.enum(JOURNAL_ENTRY_TYPES).optional(),
    description: z.string().trim().min(1).max(1000),
    reference: z.string().trim().max(100).optional().nullable(),
    currencyCode: z.string().trim().length(3),
    exchangeRate: amountField.optional(),
    lines: journalLinesSchema,
  })
  .superRefine((data, ctx) => checkLines(data.lines, ctx))

export const updateJournalEntrySchema = z
  .object({
    id: z.string().uuid(),
    entryDate: z.string().min(1).optional(),
    postingDate: z.string().min(1).optional(),
    periodId: z.string().uuid().optional(),
    entryType: z.enum(JOURNAL_ENTRY_TYPES).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    reference: z.string().trim().max(100).optional().nullable(),
    currencyCode: z.string().trim().length(3).optional(),
    exchangeRate: amountField.optional(),
    lines: journalLinesSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.lines) checkLines(data.lines, ctx)
  })

export type CreateAccountInput = z.infer<typeof createAccountSchema>
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>
export type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>

const codeField = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, hyphen or underscore')

export const PAYMENT_DIRECTIONS = ['in', 'out'] as const

export const createPaymentMethodSchema = z.object({
  code: codeField,
  name: z.string().trim().min(1).max(200),
  kind: z.enum(PAYMENT_METHOD_KINDS).optional(),
  /** The GL account the cash side of a payment posts to. */
  accountId: z.string().uuid(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  requiresReference: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial().extend({
  id: z.string().uuid(),
})

export const createCashAccountSchema = z.object({
  code: codeField,
  name: z.string().trim().min(1).max(200),
  kind: z.enum(CASH_ACCOUNT_KINDS).optional(),
  accountId: z.string().uuid(),
  currencyCode: z.string().trim().length(3),
  bankName: z.string().trim().max(200).optional().nullable(),
  iban: z
    .string()
    .trim()
    .max(34)
    .regex(/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{0,30}$/, 'An IBAN starts with a two-letter country code and two check digits')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  accountNumber: z.string().trim().max(34).optional().nullable(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

export const updateCashAccountSchema = createCashAccountSchema.partial().extend({
  id: z.string().uuid(),
})

/**
 * Opening balances: one row per account, and the entry they are posted as is
 * balanced by construction — the schema refuses a set that does not net to zero
 * rather than letting the command invent an offset.
 */
export const openingBalanceLineSchema = z.object({
  accountId: z.string().uuid(),
  debitAmount: amountField.optional(),
  creditAmount: amountField.optional(),
  description: z.string().trim().max(500).optional().nullable(),
})

export const postOpeningBalancesSchema = z
  .object({
    /** The date the books are opened at; the period is resolved from it. */
    openingDate: z.string().min(1),
    /** What the entry says it is, e.g. "Opening balances at 2026-01-01". */
    description: z.string().trim().min(1).max(1000),
    currencyCode: z.string().trim().length(3),
    lines: z.array(openingBalanceLineSchema).min(2),
  })
  .superRefine((data, ctx) => checkLines(data.lines, ctx))

export const recordPaymentSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS),
  paymentMethodId: z.string().uuid(),
  cashAccountId: z.string().uuid().optional().nullable(),
  /** The other side: what the money came from, or what it was for. */
  counterpartyAccountId: z.string().uuid(),
  amount: amountField,
  paymentDate: z.string().min(1),
  currencyCode: z.string().trim().length(3),
  description: z.string().trim().min(1).max(1000),
  /** Required when the method says so — a cheque number, a transfer reference. */
  reference: z.string().trim().max(100).optional().nullable(),
  taxCode: z.string().trim().max(40).optional().nullable(),
})

export const statementQuerySchema = z.object({
  asOf: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
})

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>
export type CreateCashAccountInput = z.infer<typeof createCashAccountSchema>
export type UpdateCashAccountInput = z.infer<typeof updateCashAccountSchema>
export type PostOpeningBalancesInput = z.infer<typeof postOpeningBalancesSchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type StatementQueryInput = z.infer<typeof statementQuerySchema>

export const createVendorSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(300),
  nameAr: z.string().trim().max(300).optional().nullable(),
  vatNumber: z.string().trim().max(40).optional().nullable(),
  crNumber: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  countryCode: z.string().trim().length(2).optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateVendorSchema = createVendorSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateVendorInput = z.infer<typeof createVendorSchema>
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>

export const vendorInvoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  expenseAccountId: z.string().uuid(),
  quantity: amountField.optional(),
  unitPriceNet: amountField.optional(),
  totalNetAmount: amountField.optional(),
  taxRate: amountField.optional(),
  taxAmount: amountField.optional(),
  totalGrossAmount: amountField.optional(),
  taxCode: z.string().trim().max(40).optional().nullable(),
})

export const createVendorInvoiceSchema = z.object({
  vendorId: z.string().uuid(),
  internalNumber: z.string().trim().max(50).optional(),
  vendorInvoiceNumber: z.string().trim().max(100).optional().nullable(),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1).optional().nullable(),
  currencyCode: z.string().trim().length(3),
  withholdingCode: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(vendorInvoiceLineSchema).min(1),
})

export const updateVendorInvoiceSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid().optional(),
  vendorInvoiceNumber: z.string().trim().max(100).optional().nullable(),
  issueDate: z.string().min(1).optional(),
  dueDate: z.string().min(1).optional().nullable(),
  currencyCode: z.string().trim().length(3).optional(),
  withholdingCode: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(vendorInvoiceLineSchema).min(1).optional(),
})

export type CreateVendorInvoiceInput = z.infer<typeof createVendorInvoiceSchema>
export type UpdateVendorInvoiceInput = z.infer<typeof updateVendorInvoiceSchema>

export const apPaymentAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: amountField,
})

export const createApPaymentSchema = z.object({
  vendorId: z.string().uuid(),
  paymentDate: z.string().min(1),
  currencyCode: z.string().trim().length(3),
  grossAmount: amountField,
  withholdingCode: z.string().trim().max(40).optional().nullable(),
  method: z.enum(['bank_transfer', 'cheque', 'cash']).optional(),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  allocations: z.array(apPaymentAllocationSchema).optional(),
})

export type CreateApPaymentInput = z.infer<typeof createApPaymentSchema>

export const voidApDocumentSchema = z.object({
  id: z.string().uuid(),
})
