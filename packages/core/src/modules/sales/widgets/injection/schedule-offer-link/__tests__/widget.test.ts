import widget from '../widget'
import { injectionTable } from '../../../injection-table'
import { extensionPoints } from '@open-mercato/core/modules/customers/extension-points'
import { resolveScheduleLinkTypes } from '@open-mercato/core/modules/customers/components/detail/schedule/linkTypes'

describe('schedule offer link contribution', () => {
  const offer = widget.linkTypes[0]!

  it('registers the quote search only through the customer host and sales permission', () => {
    expect(injectionTable[extensionPoints.hosts.scheduleLinkTypes.spotId]).toEqual({
      widgetId: widget.metadata.id,
      priority: 50,
    })
    expect(widget.metadata.features).toEqual(['sales.quotes.view'])
    expect(widget.metadata.requiredModules).toEqual(['customers'])
    expect(resolveScheduleLinkTypes([]).map((type) => type.id)).toEqual(['company', 'deal'])
    expect(resolveScheduleLinkTypes([widget]).map((type) => type.id)).toEqual(['company', 'deal', 'offer'])
    expect(offer.buildSearchUrl({ page: 2, pageSize: 20, query: ' SQ 10& ' })).toBe('/api/sales/quotes?pageSize=20&page=2&search=SQ%2010%26')
  })

  it('does not offer contributed link kinds that the schedule API cannot persist', () => {
    const unsupportedWidget = { ...widget, linkTypes: [{ ...offer, id: 'invoice' }] }
    expect(resolveScheduleLinkTypes([unsupportedWidget]).map((type) => type.id)).toEqual(['company', 'deal'])
  })

  it.each([
    [{ id: 'quote', quoteNumber: ' SQ-1 ', customerName: ' Acme ' }, 'SQ-1, Acme'],
    [{ id: 'quote', quote_number: 'SQ-2', customer_name: 'Acme' }, 'SQ-2, Acme'],
    [{ id: 'quote', documentNumber: 'SQ-3' }, 'SQ-3'],
    [{ id: 'quote', document_number: 'SQ-4' }, 'SQ-4'],
    [{ id: 'quote', externalReference: 'EXT-1' }, 'EXT-1'],
    [{ id: 'quote', external_reference: 'EXT-2' }, 'EXT-2'],
    [{ id: 'quote', quoteNumber: ' ', display_name: 'Acme' }, 'Acme'],
    [{ id: 'quote' }, 'quote'],
  ])('preserves quote label fallbacks for %j', (item, expected) => {
    expect(offer.resolveLabel(item)).toBe(expected)
  })
})
