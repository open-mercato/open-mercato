import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'

type Dictionary = Record<string, string>

const INBOUND_KEY_PATTERN =
  /^wms\.(asns\.|audit\.(asn|receivingLine)\.|backend\.(asns|putaway|receiving)\.|putaway\.title|receiving\.title|backend\.inventory\.(operations\.receive|receive\.dialog\.))/

const IDENTICAL_ALLOWED = new Set(['Status', 'ASN {id}'])

const locales: Array<[string, Dictionary]> = [
  ['pl', pl as Dictionary],
  ['de', de as Dictionary],
  ['es', es as Dictionary],
  ['ko', ko as Dictionary],
]

const inboundKeys = Object.keys(en as Dictionary).filter((key) => INBOUND_KEY_PATTERN.test(key))

describe('WMS inbound receiving and putaway translations', () => {
  it('covers the inbound receiving and putaway keys', () => {
    expect(inboundKeys.length).toBeGreaterThan(150)
    expect(inboundKeys).toContain('wms.backend.putaway.complete.errors.targetRequired')
  })

  it.each(locales)('%s translates every inbound key instead of copying English', (_locale, dictionary) => {
    const untranslated = inboundKeys.filter((key) => {
      const englishValue = (en as Dictionary)[key]
      return dictionary[key] === englishValue && !IDENTICAL_ALLOWED.has(englishValue)
    })
    const missing = inboundKeys.filter((key) => typeof dictionary[key] !== 'string')
    expect(missing).toEqual([])
    expect(untranslated).toEqual([])
  })
})
