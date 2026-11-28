import { buildIndexDocument, rebuildAggregateSearchField } from '../lib/document'
import { buildSearchTokenRows } from '../lib/search-tokens'

describe('address custom values in query indexes', () => {
  it.each(['customers:customer_address', 'sales:sales_document_address'])(
    'excludes private records and EAV values for %s',
    (entityType) => {
      const row = { city: 'Sampleville', custom_values: { gate_code: 'private' } }
      const fields = [{ key: 'gate_code', value: 'sensitive' }]
      const document = buildIndexDocument(row, fields, {}, { entityType })

      expect(document).toEqual({ city: 'Sampleville', search_text: 'Sampleville' })
      const stored = { ...document, 'cf:gate_code': 'sensitive', custom_values: 'private' }
      expect(rebuildAggregateSearchField(stored, { entityType })).toEqual(document)
      expect(buildSearchTokenRows({ entityType, recordId: 'address-1', doc: stored })
        .every((token) => token.field === 'city' || token.field === 'search_text')).toBe(true)
    },
  )

  it.each(['sales:sales_order', 'sales:sales_quote'])('excludes only address data on %s', (entityType) => {
    const row = { address_custom_values: { shipping: { gate_code: 'private' } }, city: 'Sampleville' }
    const document = buildIndexDocument(row, [{ key: 'status_note', value: 'keep' }], {}, { entityType })

    expect(document).toMatchObject({ city: 'Sampleville', 'cf:status_note': 'keep' })
    expect(document).not.toHaveProperty('address_custom_values')
  })
})
