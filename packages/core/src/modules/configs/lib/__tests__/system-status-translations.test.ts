import de from '../../i18n/de.json'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'
import pl from '../../i18n/pl.json'
import { buildSystemStatusSnapshot } from '../system-status'

const LOCALES: Record<string, Record<string, string>> = { de, en, es, ko, pl }

function collectReferencedKeys(): string[] {
  const snapshot = buildSystemStatusSnapshot({})
  const keys = new Set<string>()
  for (const category of snapshot.categories) {
    keys.add(category.labelKey)
    if (category.descriptionKey) keys.add(category.descriptionKey)
    for (const item of category.items) {
      keys.add(item.labelKey)
      if (item.descriptionKey) keys.add(item.descriptionKey)
    }
  }
  return Array.from(keys).sort()
}

describe('system status translations', () => {
  const referencedKeys = collectReferencedKeys()

  it('references the DATABASE_URL label and description keys', () => {
    expect(referencedKeys).toEqual(
      expect.arrayContaining([
        'configs.systemStatus.variables.databaseUrl.label',
        'configs.systemStatus.variables.databaseUrl.description',
      ]),
    )
  })

  it.each(Object.keys(LOCALES))('resolves every referenced key to a non-empty value in %s', (locale) => {
    const dictionary = LOCALES[locale]
    const missing = referencedKeys.filter((key) => {
      const value = dictionary[key]
      return typeof value !== 'string' || value.trim().length === 0
    })
    expect(missing).toEqual([])
  })
})
