import { createTestTranslations } from '@open-mercato/shared/lib/i18n/test-helpers'
import { metadata } from '../query-indexes/page.meta'
import de from '../../i18n/de.json'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'
import pl from '../../i18n/pl.json'

const keys = [
  metadata.pageTitleKey ?? '',
  'query_index.banner.partial_title',
  'query_index.banner.partial_description',
  'query_index.banner.partial_counts',
  'query_index.banner.partial_global_note',
  'query_index.banner.manage_indexes',
  'query_index.banner.dismiss',
].filter(Boolean)

describe('Query index status page translations', () => {
  it('has localized copy for navigation and status banner', () => {
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
