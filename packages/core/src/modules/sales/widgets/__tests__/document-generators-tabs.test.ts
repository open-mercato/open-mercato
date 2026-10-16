/**
 * @jest-environment node
 */
import orderWidget from '../injection/document-generators-order-tab/widget'
import quoteWidget from '../injection/document-generators-quote-tab/widget'

describe('sales document generator tabs', () => {
  it('adds generator tabs next to the existing history tabs', async () => {
    const { injectionTable } = await import('../injection-table')
    for (const kind of ['order', 'quote'] as const) {
      const entries = injectionTable[`sales.document.detail.${kind}:tabs`]
      const list = Array.isArray(entries) ? entries : [entries]
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ widgetId: 'sales.injection.document-history', kind: 'tab' }),
          expect.objectContaining({
            widgetId: `sales.injection.document-generators-${kind}-tab`,
            kind: 'tab',
            groupLabel: 'sales.documents.generators.tabLabel',
          }),
        ]),
      )
    }
  })

  it('gates the widgets on document and sales view features', () => {
    expect(orderWidget.metadata.id).toBe('sales.injection.document-generators-order-tab')
    expect(orderWidget.metadata.features).toEqual(['document_generators.documents.view', 'sales.orders.view'])
    expect(quoteWidget.metadata.id).toBe('sales.injection.document-generators-quote-tab')
    expect(quoteWidget.metadata.features).toEqual(['document_generators.documents.view', 'sales.quotes.view'])
  })
})
