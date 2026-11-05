/**
 * @jest-environment node
 */

describe('catalog injection table', () => {
  it('registers the bulk delete action on the spot the products table actually resolves', async () => {
    const mod = await import('../injection-table')
    const table = mod.injectionTable

    expect(table['data-table:catalog.products.list:bulk-actions']).toEqual({
      widgetId: 'catalog.injection.product-bulk-delete',
      priority: 40,
    })
    // `DataTable` derives `extensionTableId` from `perspective.tableId` before
    // `injectionSpotId`, and spot resolution is exact-match (only `*` patterns
    // fan out), so the base-spot spelling could never bind — it is not declared
    // as a host either, and the build guard rejects it.
    expect(table['data-table:catalog.products:bulk-actions']).toBeUndefined()
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
