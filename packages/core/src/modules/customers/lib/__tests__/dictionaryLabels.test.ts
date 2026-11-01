import type { AwilixContainer } from 'awilix'
import { registerTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { CUSTOMER_DICTIONARY_DEFAULTS } from '../dictionaryDefaults'
import { customerDictionaryLabelKey, localizeCustomerDictionaryEntries } from '../dictionaryLabels'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn(async (locale: string) => require(`../../i18n/${locale}.json`)),
}))

const container = {} as AwilixContainer
const options = { kind: 'status', locale: 'pl', tenantId: 'tenant-1', container }
const entry = { id: 'entry-1', value: 'active', label: 'Active', organizationId: 'org-1', color: '#22c55e' }

describe('customer dictionary labels', () => {
  beforeEach(() => registerTranslationOverlayPlugin(null, null))
  afterEach(() => registerTranslationOverlayPlugin(null, null))

  it.each(['en', 'pl', 'de', 'es', 'ko'])('ships a label for every seeded entry in %s', async (locale) => {
    const dictionary: Record<string, string> = require(`../../i18n/${locale}.json`)
    for (const [kind, defaults] of Object.entries(CUSTOMER_DICTIONARY_DEFAULTS)) {
      const entries = defaults.map((seed, index) => ({ ...seed, id: `${kind}-${index}`, organizationId: 'org-1' }))
      const localized = await localizeCustomerDictionaryEntries(entries, { ...options, kind, locale })
      expect(localized.map((item) => item.label)).toEqual(defaults.map((seed) => {
        const key = customerDictionaryLabelKey(kind, seed.value)
        expect(dictionary[key]).toBeTruthy()
        return dictionary[key]
      }))
      expect(localized.map((item) => item.value)).toEqual(entries.map((item) => item.value))
    }
  })

  it('localizes unchanged defaults without mutating the cached entries or appearance', async () => {
    const result = await localizeCustomerDictionaryEntries([entry], options)
    expect(result).toEqual([{ ...entry, label: 'Aktywny' }])
    expect(entry.label).toBe('Active')
  })

  it('preserves operator edits and non-seeded entries', async () => {
    const entries = [{ ...entry, label: 'Our active customers' }, { ...entry, value: 'custom', label: 'Active' }]
    expect(await localizeCustomerDictionaryEntries(entries, options)).toEqual(entries)
  })

  it('preserves custom kinds that share names with object properties', async () => {
    expect(await localizeCustomerDictionaryEntries([entry], { ...options, kind: 'constructor' })).toEqual([entry])
  })

  it('reads explicit translations in each owning organization, after the seeded fallback', async () => {
    const overlay = jest.fn(async (items: Record<string, unknown>[], scope: { organizationId?: string | null }) =>
      items.map((item) => ({ ...item, label: scope.organizationId === 'org-1' ? 'Nasz aktywny' : 'Aktywny nadrzędny' })),
    )
    registerTranslationOverlayPlugin(overlay, null)
    const entries = [entry, { ...entry, id: 'parent-entry', organizationId: 'parent-org' }]
    const result = await localizeCustomerDictionaryEntries(entries, options)
    expect(result.map((item) => item.label)).toEqual(['Nasz aktywny', 'Aktywny nadrzędny'])
    expect(overlay).toHaveBeenNthCalledWith(1, [{ id: entry.id, label: 'Aktywny' }], {
      entityType: 'customers:customer_dictionary_entry', locale: 'pl', tenantId: 'tenant-1', organizationId: 'org-1', container,
    })
    expect(overlay).toHaveBeenNthCalledWith(2, [{ id: 'parent-entry', label: 'Aktywny' }], expect.objectContaining({
      tenantId: 'tenant-1', organizationId: 'parent-org',
    }))
  })

  it('translates generated renewal quarters and preserves their edited labels', async () => {
    const entries = [{ ...entry, value: '2026_q3', label: 'Q3 2026' }, { ...entry, value: '2026_q4', label: 'Fourth quarter' }]
    const result = await localizeCustomerDictionaryEntries(entries, { ...options, kind: 'renewal_quarter' })
    expect(result.map((item) => item.label)).toEqual(['3. kwartał 2026', 'Fourth quarter'])
  })

  it('uses the shipped language fallback for regional locales', async () => {
    const result = await localizeCustomerDictionaryEntries([entry], { ...options, locale: 'pl-PL' })
    expect(result[0].label).toBe('Aktywny')
  })

  it('keeps dictionaries usable when the optional translation overlay fails', async () => {
    registerTranslationOverlayPlugin(jest.fn(async () => { throw new Error('unavailable') }), null)
    const result = await localizeCustomerDictionaryEntries([entry], options)
    expect(result[0].label).toBe('Aktywny')
  })
})
