/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return { fork: jest.fn(() => ({ find: jest.fn(), findOne: jest.fn() })) }
      if (token === 'accessLogService') return null
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

describe('invoice and credit memo route modules', () => {
  it('invoice route exports GET, POST, PUT, DELETE, openApi', () => {
    const invoiceRoute = require('../../api/invoices/route')
    expect(invoiceRoute.GET).toBeDefined()
    expect(typeof invoiceRoute.GET).toBe('function')
    expect(invoiceRoute.POST).toBeDefined()
    expect(typeof invoiceRoute.POST).toBe('function')
    expect(invoiceRoute.PUT).toBeDefined()
    expect(typeof invoiceRoute.PUT).toBe('function')
    expect(invoiceRoute.DELETE).toBeDefined()
    expect(typeof invoiceRoute.DELETE).toBe('function')
    expect(invoiceRoute.openApi).toBeDefined()
    expect(invoiceRoute.metadata).toBeDefined()
  })

  it('credit memo route exports GET, POST, PUT, DELETE, openApi', () => {
    const creditMemoRoute = require('../../api/credit-memos/route')
    expect(creditMemoRoute.GET).toBeDefined()
    expect(typeof creditMemoRoute.GET).toBe('function')
    expect(creditMemoRoute.POST).toBeDefined()
    expect(typeof creditMemoRoute.POST).toBe('function')
    expect(creditMemoRoute.PUT).toBeDefined()
    expect(typeof creditMemoRoute.PUT).toBe('function')
    expect(creditMemoRoute.DELETE).toBeDefined()
    expect(typeof creditMemoRoute.DELETE).toBe('function')
    expect(creditMemoRoute.openApi).toBeDefined()
    expect(creditMemoRoute.metadata).toBeDefined()
  })

  it('invoice route metadata uses .view for read and .manage for writes', () => {
    const { metadata } = require('../../api/invoices/route')
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toContain('sales.invoices.view')
    expect(metadata.POST.requireFeatures).toContain('sales.invoices.manage')
    expect(metadata.PUT.requireFeatures).toContain('sales.invoices.manage')
    expect(metadata.DELETE.requireFeatures).toContain('sales.invoices.manage')
  })

  it('credit memo route metadata uses .view for read and .manage for writes', () => {
    const { metadata } = require('../../api/credit-memos/route')
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toContain('sales.credit_memos.view')
    expect(metadata.POST.requireFeatures).toContain('sales.credit_memos.manage')
    expect(metadata.PUT.requireFeatures).toContain('sales.credit_memos.manage')
    expect(metadata.DELETE.requireFeatures).toContain('sales.credit_memos.manage')
  })

  it('invoice [id] route requires .view for read', () => {
    const { metadata } = require('../../api/invoices/[id]/route')
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toContain('sales.invoices.view')
  })

  it('credit memo [id] route requires .view for read', () => {
    const { metadata } = require('../../api/credit-memos/[id]/route')
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toContain('sales.credit_memos.view')
  })
})

describe('normalizeFinancialDocumentItem', () => {
  const { normalizeFinancialDocumentItem } = require('../../api/_documentListEnrichers')

  it('keeps invoice money fields as numeric strings and passes metadata through', () => {
    const item = normalizeFinancialDocumentItem(
      {
        id: 'inv-1',
        subtotal_net_amount: '10.00',
        subtotal_gross_amount: '12.30',
        tax_total_amount: '2.30',
        grand_total_net_amount: '10.00',
        grand_total_gross_amount: 12.3,
        discount_total_amount: null,
        paid_total_amount: '',
        outstanding_amount: '12.30',
        metadata: { source: 'import' },
      },
      'invoice',
    )
    expect(item.subtotalNetAmount).toBe('10.00')
    expect(item.subtotalGrossAmount).toBe('12.30')
    expect(item.taxTotalAmount).toBe('2.30')
    expect(item.grandTotalNetAmount).toBe('10.00')
    expect(item.grandTotalGrossAmount).toBe('12.3')
    expect(item.discountTotalAmount).toBeNull()
    expect(item.paidTotalAmount).toBeNull()
    expect(item.outstandingAmount).toBe('12.30')
    expect(item.metadata).toEqual({ source: 'import' })
  })

  it('keeps credit memo money fields as numeric strings', () => {
    const item = normalizeFinancialDocumentItem(
      {
        id: 'cm-1',
        subtotal_net_amount: '5.00',
        grand_total_gross_amount: '6.15',
        metadata: null,
      },
      'credit-memo',
    )
    expect(item.subtotalNetAmount).toBe('5.00')
    expect(item.grandTotalGrossAmount).toBe('6.15')
    expect(item.metadata).toBeNull()
  })
})
