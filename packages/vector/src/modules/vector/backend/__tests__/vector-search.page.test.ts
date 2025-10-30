import { createTestTranslations } from '@open-mercato/shared/lib/i18n/test-helpers'
import { metadata } from '../vector-search/page.meta'
import de from '../../i18n/de.json'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'
import pl from '../../i18n/pl.json'

const keys = [
  metadata.pageTitleKey ?? '',
  'vector.messages.missingKey',
].filter(Boolean)

describe('Vector search translations', () => {
  it('provides localized copy for navigation and status messaging', () => {
    const sources = { de, en, es, pl }
    for (const [locale, source] of Object.entries(sources)) {
      const { t } = createTestTranslations(source)
      for (const key of keys) {
        const value = t(key)
        expect(value).not.toBe(key)
        expect(typeof value).toBe('string')
        expect(value.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
