import { describe, it, expect } from '@jest/globals'
import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import pl from '../i18n/pl.json'

const DESCRIPTION_KEY = 'catalog.merchandising_assistant.sheet.description'

// #7735: with no product selected, this copy used to claim the panel is a
// read-only demo where "no writes are applied" — but confirming a proposed
// change does save it even without a selection, so the copy must not claim
// writes never apply.
const MISLEADING_FRAGMENTS: Record<string, string[]> = {
  en: ['read-only demo', 'no writes are applied'],
  pl: ['tylko do odczytu', 'nie są zapisywane'],
  de: ['nur-lese-demo', 'keine änderungen angewendet'],
  es: ['solo lectura', 'no se aplican cambios'],
  ko: ['읽기 전용', '적용되지 않습니다'],
}

const SAVED_FRAGMENTS: Record<string, string> = {
  en: 'saved',
  pl: 'zapisywane',
  de: 'gespeichert',
  es: 'guardan',
  ko: '저장',
}

describe('catalog merchandising assistant sheet description (#7735)', () => {
  const locales = { de, en, es, ko, pl } as Record<string, Record<string, string>>

  it.each(Object.keys(locales))(
    '%s no-selection description does not claim writes are never applied',
    (locale) => {
      const value = locales[locale][DESCRIPTION_KEY]
      expect(typeof value).toBe('string')
      const lowered = value.toLowerCase()
      for (const fragment of MISLEADING_FRAGMENTS[locale]) {
        expect(lowered).not.toContain(fragment)
      }
      expect(value).toContain(SAVED_FRAGMENTS[locale])
    },
  )
})
