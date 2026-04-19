/**
 * @jest-environment node
 */

describe('catalog injection table', () => {
  it('registers default bulk delete actions for catalog product tables', async () => {
    const mod = await import('../injection-table')
    const table = mod.injectionTable

    expect(table['data-table:catalog.products:bulk-actions']).toEqual({
      widgetId: 'catalog.injection.product-bulk-delete',
      priority: 40,
    })
    expect(table['data-table:catalog.products.list:bulk-actions']).toEqual({
      widgetId: 'catalog.injection.product-bulk-delete',
      priority: 40,
    })
  })

  it('registers the merchandising assistant trigger on the products list header (Step 5.15)', async () => {
    const mod = await import('../injection-table')
    const table = mod.injectionTable

    expect(table['data-table:catalog.products:header']).toEqual([
      {
        widgetId: 'catalog.injection.merchandising-assistant-trigger',
        priority: 100,
      },
    ])
  })
})
