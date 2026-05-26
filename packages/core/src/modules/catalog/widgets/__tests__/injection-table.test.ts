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

  it('registers the merchandising assistant trigger on the products list search-trailing slot', async () => {
    const mod = await import('../injection-table')
    const table = mod.injectionTable

    // Step 5.15 originally targeted `:header`; the trigger now lives in
    // `:search-trailing` so it renders as a compact icon-only button on
    // the same row as the list search input.
    expect(table['data-table:catalog.products:search-trailing']).toEqual([
      {
        widgetId: 'catalog.injection.merchandising-assistant-trigger',
        priority: 100,
      },
    ])
  })
})
