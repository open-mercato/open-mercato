import { postSalesInvoiceToLedgerSchema } from '../validators'

const INVOICE = '11111111-1111-4111-8111-111111111111'
const LINE_A = '22222222-2222-4222-8222-222222222222'
const LINE_B = '33333333-3333-4333-8333-333333333333'
const ACCOUNT = '44444444-4444-4444-8444-444444444444'
const CONTRACTOR = '55555555-5555-4555-8555-555555555555'

describe('postSalesInvoiceToLedgerSchema', () => {
  it('accepts an invoice with one account per line and no contractor', () => {
    const parsed = postSalesInvoiceToLedgerSchema.parse({
      salesInvoiceId: INVOICE,
      lineAccounts: [
        { salesInvoiceLineId: LINE_A, accountId: ACCOUNT },
        { salesInvoiceLineId: LINE_B, accountId: ACCOUNT },
      ],
    })
    expect(parsed.contractorId).toBeUndefined()
    expect(parsed.lineAccounts).toHaveLength(2)
  })

  it('accepts an explicit contractor id', () => {
    const parsed = postSalesInvoiceToLedgerSchema.parse({
      salesInvoiceId: INVOICE,
      lineAccounts: [{ salesInvoiceLineId: LINE_A, accountId: ACCOUNT }],
      contractorId: CONTRACTOR,
    })
    expect(parsed.contractorId).toBe(CONTRACTOR)
  })

  it.each([
    ['a non-uuid invoice id', { salesInvoiceId: 'invoice-1', lineAccounts: [] }],
    ['a non-uuid line id', { salesInvoiceId: INVOICE, lineAccounts: [{ salesInvoiceLineId: 'line', accountId: ACCOUNT }] }],
    ['a non-uuid account id', { salesInvoiceId: INVOICE, lineAccounts: [{ salesInvoiceLineId: LINE_A, accountId: '401-01' }] }],
    ['a non-uuid contractor id', { salesInvoiceId: INVOICE, lineAccounts: [], contractorId: 'nip-123' }],
    ['a missing assignment list', { salesInvoiceId: INVOICE }],
  ])('rejects %s', (_label, input) => {
    expect(postSalesInvoiceToLedgerSchema.safeParse(input).success).toBe(false)
  })

  it('leaves empty and duplicated assignments to the command, which answers them with 422', () => {
    expect(postSalesInvoiceToLedgerSchema.safeParse({ salesInvoiceId: INVOICE, lineAccounts: [] }).success).toBe(true)
    expect(
      postSalesInvoiceToLedgerSchema.safeParse({
        salesInvoiceId: INVOICE,
        lineAccounts: [
          { salesInvoiceLineId: LINE_A, accountId: ACCOUNT },
          { salesInvoiceLineId: LINE_A, accountId: ACCOUNT },
        ],
      }).success,
    ).toBe(true)
  })
})
