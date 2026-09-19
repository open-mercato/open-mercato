import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  creditMemoCreateSchema,
  invoiceCreateSchema,
} from '../../data/validators'

const documents = readFileSync(join(__dirname, '..', 'documents.ts'), 'utf8')

const scope = { organizationId: '00000000-0000-4000-8000-000000000001', tenantId: '00000000-0000-4000-8000-000000000002' }

describe('invoice and credit memo tax validators', () => {
  it('accepts the five tax fields on an invoice with no source document', () => {
    const parsed = invoiceCreateSchema.safeParse({
      ...scope,
      currencyCode: 'USD',
      taxStrategyKey: 'avalara',
      taxInfo: { version: 1 },
      taxStatus: 'calculated',
      taxCalculatedAt: '2026-09-19T00:00:00.000Z',
      taxTransactionRef: 'txn-1',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.taxStrategyKey).toBe('avalara')
      expect(parsed.data.taxCalculatedAt).toBeInstanceOf(Date)
    }
  })

  it('accepts the five tax fields on a credit memo', () => {
    const parsed = creditMemoCreateSchema.safeParse({
      ...scope,
      currencyCode: 'USD',
      taxStatus: 'exempt',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a tax status outside the documented set', () => {
    const parsed = invoiceCreateSchema.safeParse({
      ...scope,
      currencyCode: 'USD',
      taxStatus: 'pending',
    })
    expect(parsed.success).toBe(false)
  })

  it('leaves the tax fields optional, so no existing caller breaks', () => {
    expect(invoiceCreateSchema.safeParse({ ...scope, currencyCode: 'USD' }).success).toBe(true)
    expect(creditMemoCreateSchema.safeParse({ ...scope, currencyCode: 'USD' }).success).toBe(true)
  })
})

/**
 * Invoices and credit memos take caller totals and never recalculate, so their
 * provenance has to come from the document they were raised from — otherwise an
 * invoice would silently report no tax provenance for an order that has one.
 */
describe('invoice and credit memo tax inheritance', () => {
  it('spreads the resolved columns into both create literals', () => {
    const spreads = documents.match(/\.\.\.inheritedTax,/g) ?? []
    expect(spreads.length).toBe(2)
  })

  it('resolves the invoice source from the order it bills', () => {
    expect(documents).toContain('source: sourceOrder,')
    expect(documents).toContain('sourceNumber: sourceOrder?.orderNumber ?? null,')
  })

  it('prefers the invoice over the order for a credit memo', () => {
    expect(documents).toContain('source: sourceInvoice ?? sourceOrder,')
    expect(documents).toContain(
      'sourceNumber: sourceInvoice?.invoiceNumber ?? sourceOrder?.orderNumber ?? null,'
    )
  })

  it('reuses the entity the scope validation already loaded, adding no query', () => {
    // The handlers previously discarded these lookups into `orderExists` /
    // `invoiceExists` locals; inheritance reads the same rows.
    expect(documents).toContain('let sourceOrder: SalesOrder | null = null;')
    expect(documents).toContain('let sourceInvoice: SalesInvoice | null = null;')
  })

  it('appends an inherited message rather than replacing the source messages', () => {
    expect(documents).toContain('...parsed.messages,')
    expect(documents).toContain("code: 'inherited',")
  })

  it('ignores caller supplied columns when a source document is present', () => {
    // resolveInheritedTaxColumns only reads `supplied` on the no-source branch.
    const helper = documents.slice(
      documents.indexOf('function resolveInheritedTaxColumns'),
      documents.indexOf('function applyQuoteTotals')
    )
    const suppliedReads = helper.match(/supplied\./g) ?? []
    expect(suppliedReads.length).toBeGreaterThan(0)
    // Every read of the caller's values sits on the no-source branch, which
    // returns before the source is ever consulted.
    expect(helper.lastIndexOf('supplied.')).toBeLessThan(helper.indexOf('if (!source.taxInfo'))
  })
})
