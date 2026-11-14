import { CUSTOMER_DICTIONARY_KINDS, dictionaryValueAppearance } from '../dictionaries'

const STATUS_KINDS = ['statuses', 'deal-statuses', 'interaction-statuses'] as const

describe('dictionaryValueAppearance', () => {
  it.each(STATUS_KINDS)('shows the colour disc on the %s dictionary', (kind) => {
    expect(dictionaryValueAppearance(kind)).toBe('pill-dot')
  })

  it.each(CUSTOMER_DICTIONARY_KINDS.filter((kind) => !(STATUS_KINDS as readonly string[]).includes(kind)))(
    'keeps the %s dictionary colourless',
    (kind) => {
      expect(dictionaryValueAppearance(kind)).toBe('pill')
    },
  )
})
