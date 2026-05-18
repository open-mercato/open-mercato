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
