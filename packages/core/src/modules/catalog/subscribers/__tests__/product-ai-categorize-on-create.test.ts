import handle, { metadata } from '../product-ai-categorize-on-create'

const enqueueOnCreateSuggestion = jest.fn()

jest.mock('../../lib/aiCategorization/onCreateSuggest', () => ({
  enqueueOnCreateSuggestion: (...args: unknown[]) => enqueueOnCreateSuggestion(...args),
}))

describe('catalog product-ai-categorize-on-create subscriber', () => {
  beforeEach(() => {
    enqueueOnCreateSuggestion.mockReset()
    enqueueOnCreateSuggestion.mockResolvedValue({ proceed: true })
  })

  it('is a persistent subscriber on catalog.product.created with a stable id', () => {
    expect(metadata).toEqual({
      event: 'catalog.product.created',
      persistent: true,
      id: 'catalog:product-ai-categorize-on-create',
    })
  })

  it('forwards the scoped product to the enqueue helper', async () => {
    const ctx = { resolve: jest.fn() }
    await handle({ id: 'product-1', tenantId: 'tenant-1', organizationId: 'org-1' }, ctx)
    expect(enqueueOnCreateSuggestion).toHaveBeenCalledWith({
      container: ctx,
      productId: 'product-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('ignores events without full tenant and organization scope', async () => {
    const ctx = { resolve: jest.fn() }
    await handle({ id: 'product-1', tenantId: 'tenant-1', organizationId: null }, ctx)
    await handle({ id: null, tenantId: 'tenant-1', organizationId: 'org-1' }, ctx)
    expect(enqueueOnCreateSuggestion).not.toHaveBeenCalled()
  })
})
