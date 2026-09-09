import { resolveLocaleLabel } from '../locale-label'
import type { TranslateFn } from '../context'

// Mirrors how `LanguageSwitcher` and `PayPage` call it: a real translator that
// falls back to the inline default when the key is absent from the dictionary.
function makeTranslator(dict: Record<string, string> = {}): TranslateFn {
  return ((key: string, fallbackOrParams?: unknown) => {
    const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : undefined
    return dict[key] ?? fallback ?? key
  }) as TranslateFn
}

describe('resolveLocaleLabel', () => {
  describe('shipped locales without a translator (ProfileDropdown behaviour)', () => {
    // These are the exact strings `ProfileDropdown` rendered from its hardcoded
    // `Record<Locale, string>` before it was replaced — a visual regression guard.
    it.each([
      ['en', 'English'],
      ['de', 'Deutsch'],
      ['es', 'Español'],
      ['pl', 'Polski'],
      ['ko', '한국어'],
    ])('renders %s as the endonym %s', (locale, expected) => {
      expect(resolveLocaleLabel(locale)).toBe(expected)
    })
  })

  describe('shipped locales with a translator (LanguageSwitcher behaviour)', () => {
    // The exact `t(key, fallback)` pairs the switcher used before the refactor.
    it.each([
      ['en', 'common.languages.english', 'English'],
      ['pl', 'common.languages.polish', 'Polski'],
      ['es', 'common.languages.spanish', 'Español'],
      ['de', 'common.languages.german', 'Deutsch'],
      ['ko', 'common.languages.korean', '한국어'],
    ])('asks for %s via %s and falls back to %s', (locale, key, fallback) => {
      const seen: string[] = []
      const t = ((k: string, f?: unknown) => {
        seen.push(k)
        return typeof f === 'string' ? f : k
      }) as TranslateFn

      expect(resolveLocaleLabel(locale, t)).toBe(fallback)
      expect(seen).toEqual([key])
    })

    it('prefers the dictionary value, so a German UI shows localized names', () => {
      const t = makeTranslator({
        'common.languages.polish': 'Polnisch',
        'common.languages.english': 'Englisch',
      })

      expect(resolveLocaleLabel('pl', t)).toBe('Polnisch')
      expect(resolveLocaleLabel('en', t)).toBe('Englisch')
    })
  })

  describe('locales the platform does not ship', () => {
    it('falls back to the endonym from Intl', () => {
      expect(resolveLocaleLabel('cs')).toBe('čeština')
      expect(resolveLocaleLabel('fr')).toBe('français')
    })

    it('uses the endonym even when a translator is supplied', () => {
      // There is no `common.languages.*` key for an app-added locale, so the
      // translator cannot help and must not produce a raw key.
      expect(resolveLocaleLabel('cs', makeTranslator())).toBe('čeština')
    })

    it('never renders blank or a raw key', () => {
      for (const locale of ['cs', 'fr', 'zh', 'sw', 'zzz']) {
        const label = resolveLocaleLabel(locale)
        expect(label.length).toBeGreaterThan(0)
        expect(label).not.toContain('common.languages')
      }
    })
  })

  describe('degradation ladder', () => {
    it('falls back to the uppercased code for an unknown code', () => {
      // `zzz` is neither an ISO 639-1 entry nor known to Intl.
      expect(resolveLocaleLabel('zzz')).toBe('ZZZ')
    })

    it('uses the ISO 639-1 English name when Intl has no data', () => {
      const displayNames = jest
        .spyOn(Intl, 'DisplayNames')
        .mockImplementation((() => ({ of: () => undefined })) as unknown as typeof Intl.DisplayNames)

      try {
        // `za` (Zhuang) is in the ISO catalogue with the label "Zhuang".
        expect(resolveLocaleLabel('za')).toBe('Zhuang')
      } finally {
        displayNames.mockRestore()
      }
    })

    it('survives Intl throwing on a malformed code', () => {
      expect(() => resolveLocaleLabel('!!not a tag!!')).not.toThrow()
      expect(resolveLocaleLabel('!!not a tag!!')).toBe('!!NOT A TAG!!')
    })
  })
})
