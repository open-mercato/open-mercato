import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import pl from '../i18n/pl.json'
import { XERO_ROUTE_ERROR_FALLBACKS, xeroErrorTranslationKey } from '../lib/route-errors'

const locales: Record<string, Record<string, string>> = { de, en, es, ko, pl }

describe('sync_xero translations', () => {
  it('translates every route error code in every locale, and the English text matches the fallback', () => {
    for (const [code, fallback] of Object.entries(XERO_ROUTE_ERROR_FALLBACKS)) {
      const key = xeroErrorTranslationKey(code)
      for (const dictionary of Object.values(locales)) expect(dictionary[key]).toEqual(expect.any(String))
      expect(en[key as keyof typeof en]).toBe(fallback)
    }
  })

  it('keeps the same keys in every locale', () => {
    const keys = Object.keys(en).sort()
    for (const dictionary of Object.values(locales)) expect(Object.keys(dictionary).sort()).toEqual(keys)
  })
})
