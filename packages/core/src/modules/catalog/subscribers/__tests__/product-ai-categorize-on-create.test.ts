import handle, { metadata } from '../product-ai-categorize-on-create'

const enqueueOnCreateSuggestion = jest.fn()

jest.mock('../../lib/aiCategorization/onCreateSuggest', () => ({
  enqueueOnCreateSuggestion: (...args: unknown[]) => enqueueOnCreateSuggestion(...args),
}))

function buildContext(scope: { tenantId?: string | null; organizationId?: string | null }) {
  return { resolve: jest.fn(), ...scope }
}

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

  it('forwards the product with the trusted context scope', async () => {
    const ctx = buildContext({ tenantId: 'tenant-1', organizationId: 'org-1' })
    await handle({ id: 'product-1' }, ctx)
    expect(enqueueOnCreateSuggestion).toHaveBeenCalledWith({
      container: ctx,
      productId: 'product-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('accepts a payload whose scope matches the trusted context', async () => {
    const ctx = buildContext({ tenantId: 'tenant-1', organizationId: 'org-1' })
    await handle({ id: 'product-1', tenantId: 'tenant-1', organizationId: 'org-1' }, ctx)
    expect(enqueueOnCreateSuggestion).toHaveBeenCalledTimes(1)
  })

  it('rejects a payload carrying another tenant scope than the trusted context', async () => {
    const ctx = buildContext({ tenantId: 'tenant-A', organizationId: 'org-A' })
    await handle({ id: 'product-1', tenantId: 'tenant-B', organizationId: 'org-B' }, ctx)
    expect(enqueueOnCreateSuggestion).not.toHaveBeenCalled()
  })

  it('rejects a payload whose organization differs even when the tenant matches', async () => {
    const ctx = buildContext({ tenantId: 'tenant-A', organizationId: 'org-A' })
    await handle({ id: 'product-1', tenantId: 'tenant-A', organizationId: 'org-B' }, ctx)
    expect(enqueueOnCreateSuggestion).not.toHaveBeenCalled()
  })

  it('never takes scope from the payload when the trusted context has none', async () => {
    await handle({ id: 'product-1', tenantId: 'tenant-B', organizationId: 'org-B' }, buildContext({}))
    await handle({ id: 'product-1', tenantId: 'tenant-B', organizationId: 'org-B' }, buildContext({ tenantId: 'tenant-A' }))
    await handle({ id: 'product-1', tenantId: 'tenant-B', organizationId: 'org-B' }, buildContext({ organizationId: 'org-A' }))
    expect(enqueueOnCreateSuggestion).not.toHaveBeenCalled()
  })

  it('ignores events without a product id', async () => {
    await handle({ id: null }, buildContext({ tenantId: 'tenant-1', organizationId: 'org-1' }))
    expect(enqueueOnCreateSuggestion).not.toHaveBeenCalled()
  })
})
