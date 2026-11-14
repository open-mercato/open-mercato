import en from '../../../i18n/en.json'
import pl from '../../../i18n/pl.json'
import de from '../../../i18n/de.json'
import es from '../../../i18n/es.json'
import ko from '../../../i18n/ko.json'

const KEY = 'example.widgets.catalogSeoReport.docs'

// This key lives in the app-level i18n overlay (apps/mercato/src/i18n/*.json),
// which `loadDictionary` (packages/shared/src/lib/i18n/server.ts) merges last and
// always wins over the `example` module's own locale files. A module-only
// locale test would not catch a regression here because it never reads this
// overlay — see issue #8793, where pl/de/es silently fell back to the English
// sentence even though the module-level translations were correct.
describe('app-level i18n overlay: example.widgets.catalogSeoReport.docs', () => {
  const englishValue = (en as Record<string, string>)[KEY]

  it('defines the key for every supported locale', () => {
    for (const dict of [en, pl, de, es, ko]) {
      expect(typeof (dict as Record<string, string>)[KEY]).toBe('string')
    }
  })

  it.each([
    ['pl', pl],
    ['de', de],
    ['es', es],
  ])('translates the merged %s dictionary value instead of falling back to English', (_locale, dict) => {
    const value = (dict as Record<string, string>)[KEY]
    expect(value).not.toBe(englishValue)
  })
})
