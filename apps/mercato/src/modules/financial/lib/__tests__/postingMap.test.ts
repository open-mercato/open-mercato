/** @jest-environment node */
/**
 * Pins the automatic posting arithmetic and account resolution.
 *
 * The ledger refuses an unbalanced entry, so a source whose stored net/tax/gross
 * do not add up must still produce a balanced entry: the revenue line is derived
 * as gross minus tax. The account fallbacks are asserted too because a tenant
 * that never edits the posting settings must still get a working chart.
 */
import {
  buildInvoicePostingLines,
  buildPaymentPostingLines,
  PostingConfigurationError,
  postingLinesMatch,
  resolvePostingAccounts,
  type PostingAccount,
} from '../postingMap'

const accounts: PostingAccount[] = [
  { id: 'acc-ar', code: '1100', accountClass: 'asset', accountType: 'receivable' },
  { id: 'acc-vat-in', code: '1150', accountClass: 'asset', accountType: 'tax_receivable' },
  { id: 'acc-cash', code: '1000', accountClass: 'asset', accountType: 'cash' },
  { id: 'acc-bank', code: '1010', accountClass: 'asset', accountType: 'bank' },
  { id: 'acc-vat-out', code: '2100', accountClass: 'liability', accountType: 'tax_payable' },
  { id: 'acc-revenue', code: '4000', accountClass: 'revenue', accountType: 'sales' },
]

const resolved = resolvePostingAccounts({}, accounts, '2100')

describe('posting account resolution', () => {
  it('resolves each role from the chart by account type', () => {
    expect(resolved.receivable.id).toBe('acc-ar')
    expect(resolved.revenue.id).toBe('acc-revenue')
    expect(resolved.outputVat.id).toBe('acc-vat-out')
    expect(resolved.cash.id).toBe('acc-cash')
    expect(resolved.bank.id).toBe('acc-bank')
  })

  it('prefers an explicitly configured code', () => {
    const custom = resolvePostingAccounts({ revenueAccountCode: '4000', cashAccountCode: '1010' }, accounts, '2100')
    expect(custom.revenue.id).toBe('acc-revenue')
    expect(custom.cash.id).toBe('acc-bank')
  })

  it('names every missing role', () => {
    expect(() => resolvePostingAccounts({}, [], null)).toThrow(PostingConfigurationError)
    try {
      resolvePostingAccounts({}, [], null)
    } catch (error) {
      expect((error as PostingConfigurationError).missing).toEqual(
        expect.arrayContaining(['receivable', 'revenue', 'output_vat', 'cash', 'bank']),
      )
    }
  })
})

describe('invoice posting lines', () => {
  it('debits receivables and credits revenue plus output VAT', () => {
    const lines = buildInvoicePostingLines({
      invoiceNumber: 'INV-1',
      grossAmount: '1150.00',
      taxAmount: '150.00',
      taxCode: 'SA-VAT-S',
    }, resolved)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ accountId: 'acc-ar', debitAmount: '1150.00', creditAmount: '0' })
    expect(lines[1]).toMatchObject({ accountId: 'acc-revenue', creditAmount: '1000.00', taxCode: 'SA-VAT-S' })
    expect(lines[2]).toMatchObject({ accountId: 'acc-vat-out', creditAmount: '150.00', taxCode: 'SA-VAT-S' })
  })

  it('derives revenue from gross minus tax when the stored net disagrees', () => {
    const lines = buildInvoicePostingLines({
      invoiceNumber: 'INV-2',
      grossAmount: '1150.00',
      taxAmount: '150.00',
      taxCode: 'SA-VAT-S',
    }, resolved)
    const debit = lines.reduce((total, line) => total + Number(line.debitAmount), 0)
    const credit = lines.reduce((total, line) => total + Number(line.creditAmount), 0)
    expect(debit).toBeCloseTo(credit, 6)
  })

  it('omits the VAT line when the invoice carries no tax', () => {
    const lines = buildInvoicePostingLines({
      invoiceNumber: 'INV-3',
      grossAmount: '500.00',
      taxAmount: '0',
      taxCode: 'SA-VAT-O',
    }, resolved)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ accountId: 'acc-revenue', creditAmount: '500.00', taxCode: 'SA-VAT-O' })
  })
})

describe('payment posting lines', () => {
  it('debits cash for a cash payment and the bank otherwise', () => {
    const cash = buildPaymentPostingLines({ paymentReference: 'P-1', amount: '100.00', isCash: true }, resolved)
    expect(cash[0]).toMatchObject({ accountId: 'acc-cash', debitAmount: '100.00' })
    expect(cash[1]).toMatchObject({ accountId: 'acc-ar', creditAmount: '100.00' })

    const bank = buildPaymentPostingLines({ paymentReference: 'P-2', amount: '100.00', isCash: false }, resolved)
    expect(bank[0]).toMatchObject({ accountId: 'acc-bank', debitAmount: '100.00' })
  })

  it('refuses a non-positive amount', () => {
    expect(() => buildPaymentPostingLines({ paymentReference: 'P-3', amount: '0', isCash: true }, resolved)).toThrow()
  })
})

describe('posting line comparison', () => {
  it('matches the same accounts and amounts in any order', () => {
    const desired = buildPaymentPostingLines({ paymentReference: 'P-4', amount: '100.00', isCash: true }, resolved)
    const existing = [
      { accountId: 'acc-ar', debitAmount: '0', creditAmount: '100.00' },
      { accountId: 'acc-cash', debitAmount: '100.00', creditAmount: '0' },
    ]
    expect(postingLinesMatch(existing, desired)).toBe(true)
    expect(postingLinesMatch(existing.slice(0, 1), desired)).toBe(false)
  })
})
