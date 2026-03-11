import { readLayeredAkeneoValue, readPreferredAkeneoValue } from '../lib/catalog-importer'

describe('akeneo catalog importer value resolution', () => {
  it('does not fall back to a different locale when a base locale is selected', () => {
    const value = readPreferredAkeneoValue(
      {
        description: [
          { locale: 'de_DE', scope: null, data: 'Deutsch' },
          { locale: 'fr_FR', scope: null, data: 'Francais' },
        ],
      },
      'description',
      'en_US',
      null,
    )

    expect(value).toBeNull()
  })

  it('still falls back to non-localized values for non-localizable attributes', () => {
    const value = readPreferredAkeneoValue(
      {
        sku: [
          { locale: null, scope: null, data: 'SKU-123' },
          { locale: 'de_DE', scope: null, data: 'SKU-DE' },
        ],
      },
      'sku',
      'en_US',
      null,
    )

    expect(value).toBe('SKU-123')
  })

  it('does not fall back to a different channel when a channel is selected', () => {
    const value = readPreferredAkeneoValue(
      {
        name: [
          { locale: 'en_US', scope: 'print', data: 'Print title' },
          { locale: 'en_US', scope: 'mobile', data: 'Mobile title' },
        ],
      },
      'name',
      'en_US',
      'ecommerce',
    )

    expect(value).toBeNull()
  })

  it('checks later layers without leaking other locales into the selected one', () => {
    const value = readLayeredAkeneoValue(
      [
        {
          description: [
            { locale: 'de_DE', scope: null, data: 'Deutsch' },
          ],
        },
        {
          description: [
            { locale: 'en_US', scope: null, data: 'English' },
          ],
        },
      ],
      'description',
      'en_US',
      null,
    )

    expect(value).toBe('English')
  })
})
