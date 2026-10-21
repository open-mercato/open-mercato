/**
 * The mechanical half of automatic posting: which account each side of a sales
 * document lands on, and the lines that result.
 *
 * Kept pure so the arithmetic and the account choice are testable without a
 * database. The caller owns the reads (settings, chart, source document) and the
 * writes (the journal entry); this module only answers "given these figures and
 * this chart, what balances?".
 *
 * The revenue line is `gross - tax`, not the invoice's stored net total. The
 * ledger refuses an unbalanced entry, and a source whose net/tax/gross do not add
 * up would otherwise fail at the last step; deriving the revenue side from the
 * two amounts that must balance makes the posting self-correcting and leaves the
 * stored totals for reporting.
 */
import { isZeroDecimal, roundDecimalHalfUp, subtractDecimalStrings } from './money'
import type { JournalLineDraft } from './glService'

export type PostingSettings = {
  receivableAccountCode?: string | null
  revenueAccountCode?: string | null
  outputVatAccountCode?: string | null
  payableAccountCode?: string | null
  inputVatAccountCode?: string | null
  cashAccountCode?: string | null
  bankAccountCode?: string | null
}

export type PostingAccount = {
  id: string
  code: string
  accountClass: string
  accountType?: string | null
}

export type PostingAccounts = {
  receivable: PostingAccount
  revenue: PostingAccount
  outputVat: PostingAccount
  cash: PostingAccount
  bank: PostingAccount
}

export type PostingLineDraft = {
  accountId: string
  debitAmount: string
  creditAmount: string
  description: string
  taxCode: string | null
}

export class PostingConfigurationError extends Error {
  constructor(readonly missing: string[]) {
    super(`[internal] Missing posting accounts: ${missing.join(', ')}`)
    this.name = 'PostingConfigurationError'
  }
}

function pickByCode(accounts: PostingAccount[], code: string | null | undefined): PostingAccount | null {
  if (!code) return null
  return accounts.find((account) => account.code === code) ?? null
}

function pickByType(accounts: PostingAccount[], accountType: string): PostingAccount | null {
  return accounts.find((account) => account.accountType === accountType) ?? null
}

export function resolvePostingAccounts(
  settings: PostingSettings,
  accounts: PostingAccount[],
  standardTaxAccountCode?: string | null,
): PostingAccounts {
  const missing: string[] = []
  const resolve = (role: string, configured: string | null | undefined, accountType: string): PostingAccount => {
    const account = pickByCode(accounts, configured) ?? pickByType(accounts, accountType)
    if (!account) {
      missing.push(role)
      return { id: '', code: '', accountClass: '' }
    }
    return account
  }

  const outputVat = pickByCode(accounts, settings.outputVatAccountCode)
    ?? pickByCode(accounts, standardTaxAccountCode)
    ?? pickByType(accounts, 'tax_payable')
  if (!outputVat) missing.push('output_vat')

  const resolved: PostingAccounts = {
    receivable: resolve('receivable', settings.receivableAccountCode, 'receivable'),
    revenue: resolve('revenue', settings.revenueAccountCode, 'sales'),
    outputVat: outputVat ?? { id: '', code: '', accountClass: '' },
    cash: resolve('cash', settings.cashAccountCode, 'cash'),
    bank: resolve('bank', settings.bankAccountCode, 'bank'),
  }
  if (missing.length > 0) throw new PostingConfigurationError(missing)
  return resolved
}

export type PayablePostingAccounts = {
  payable: PostingAccount
  inputVat: PostingAccount
  cash: PostingAccount
  bank: PostingAccount
}

export function resolvePayablePostingAccounts(
  settings: PostingSettings,
  accounts: PostingAccount[],
  standardPurchaseTaxAccountCode?: string | null,
): PayablePostingAccounts {
  const missing: string[] = []
  const resolve = (role: string, configured: string | null | undefined, accountType: string): PostingAccount => {
    const account = pickByCode(accounts, configured) ?? pickByType(accounts, accountType)
    if (!account) {
      missing.push(role)
      return { id: '', code: '', accountClass: '' }
    }
    return account
  }
  const inputVat = pickByCode(accounts, settings.inputVatAccountCode)
    ?? pickByCode(accounts, standardPurchaseTaxAccountCode)
    ?? pickByType(accounts, 'tax_receivable')
  if (!inputVat) missing.push('input_vat')
  const resolved: PayablePostingAccounts = {
    payable: resolve('payable', settings.payableAccountCode, 'payable'),
    inputVat: inputVat ?? { id: '', code: '', accountClass: '' },
    cash: resolve('cash', settings.cashAccountCode, 'cash'),
    bank: resolve('bank', settings.bankAccountCode, 'bank'),
  }
  if (missing.length > 0) throw new PostingConfigurationError(missing)
  return resolved
}

export type InvoicePostingInput = {
  invoiceNumber: string
  grossAmount: string
  taxAmount: string
  taxCode: string | null
}

export function buildInvoicePostingLines(
  input: InvoicePostingInput,
  accounts: PostingAccounts,
): PostingLineDraft[] {
  const gross = roundDecimalHalfUp(input.grossAmount, 2)
  const tax = roundDecimalHalfUp(input.taxAmount, 2)
  const net = roundDecimalHalfUp(subtractDecimalStrings(gross, tax, 6), 2)
  if (net.startsWith('-')) {
    throw new Error('[internal] Invoice tax exceeds its gross total; refusing to post a negative revenue line.')
  }

  const label = `Sales invoice ${input.invoiceNumber}`
  const lines: PostingLineDraft[] = [
    {
      accountId: accounts.receivable.id,
      debitAmount: gross,
      creditAmount: '0',
      description: label,
      taxCode: null,
    },
    {
      accountId: accounts.revenue.id,
      debitAmount: '0',
      creditAmount: net,
      description: `${label} — revenue`,
      taxCode: input.taxCode,
    },
  ]
  if (!isZeroDecimal(tax)) {
    lines.push({
      accountId: accounts.outputVat.id,
      debitAmount: '0',
      creditAmount: tax,
      description: `${label} — output VAT`,
      taxCode: input.taxCode,
    })
  }
  return lines
}

export type PaymentPostingInput = {
  paymentReference: string
  amount: string
  isCash: boolean
}

export function buildPaymentPostingLines(
  input: PaymentPostingInput,
  accounts: PostingAccounts,
): PostingLineDraft[] {
  const amount = roundDecimalHalfUp(input.amount, 2)
  if (isZeroDecimal(amount) || amount.startsWith('-')) {
    throw new Error('[internal] Payment amount must be positive.')
  }
  const asset = input.isCash ? accounts.cash : accounts.bank
  const label = `Sales payment ${input.paymentReference}`
  return [
    {
      accountId: asset.id,
      debitAmount: amount,
      creditAmount: '0',
      description: label,
      taxCode: null,
    },
    {
      accountId: accounts.receivable.id,
      debitAmount: '0',
      creditAmount: amount,
      description: `${label} — receivable settlement`,
      taxCode: null,
    },
  ]
}

export function postingLinesMatch(
  existing: Array<{ accountId: string; debitAmount: string | number; creditAmount: string | number }>,
  desired: readonly JournalLineDraft[],
): boolean {
  if (existing.length !== desired.length) return false
  return desired.every((line) => existing.some((current) =>
    current.accountId === line.accountId
    && roundDecimalHalfUp(current.debitAmount, 2) === roundDecimalHalfUp(line.debitAmount, 2)
    && roundDecimalHalfUp(current.creditAmount, 2) === roundDecimalHalfUp(line.creditAmount, 2)))
}
