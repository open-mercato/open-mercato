import pl from '../i18n/pl.json'

type Dictionary = Record<string, string>

const dictionary = pl as Dictionary

const LOCATION_TYPES = ['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging']

const DESCRIPTION_KEYS = [
  'wms.backend.config.description',
  'wms.backend.config.locations.description',
  'wms.backend.config.locations.empty.description',
  'wms.backend.config.profiles.description',
  'wms.backend.config.profiles.empty.description',
  'wms.backend.config.zones.description',
  'wms.backend.inventory.balances.description',
  'wms.backend.inventory.balances.empty.description',
  'wms.backend.inventory.balances.empty.title',
  'wms.backend.inventory.release.dialog.description',
]

const ENGLISH_FRAGMENTS = /\b(phase|bucket\w*|aisle|bin|dock|pick face|bulk|on-hand|reserved|allocated|available|per|lot\/serial|low-stock|ledger\w*)\b/i

describe('WMS Polish locale consistency', () => {
  it.each(LOCATION_TYPES)('uses the same Polish label for location type %s in the form and detail keys', (type) => {
    const formLabel = dictionary[`wms.backend.config.locations.type.${type}`]
    const detailLabel = dictionary[`wms.backend.location.types.${type}`]
    expect(typeof detailLabel).toBe('string')
    expect(formLabel).toBe(detailLabel)
  })

  it.each(DESCRIPTION_KEYS)('keeps %s free of untranslated English terms', (key) => {
    const value = dictionary[key]
    expect(typeof value).toBe('string')
    expect(value).not.toMatch(ENGLISH_FRAGMENTS)
  })

  it('names the putaway operation consistently as "rozlokowanie"', () => {
    const putawayEntries = Object.entries(dictionary).filter(([key]) => /putaway/i.test(key))
    expect(putawayEntries.length).toBeGreaterThan(0)
    const inconsistent = putawayEntries.filter(([, value]) => /odłoż|odkład/i.test(value))
    expect(inconsistent).toEqual([])
    expect(dictionary['wms.backend.dashboard.activity.types.putaway']).toBe('Rozlokowanie')
  })
})
