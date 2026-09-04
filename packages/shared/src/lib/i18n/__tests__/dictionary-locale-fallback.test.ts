import {
  loadDictionary,
  registerModules,
  registerAppDictionaryLoader,
  invalidateDictionaryCache,
} from '../server'
import { clearRegisteredLocales, registerLocales } from '../locale-registry'
import type { Locale } from '../config'

// Dictionaries keyed by locale, standing in for the app's `i18n/<locale>.json`
// files. `cs` deliberately has no entry, which is the situation an operator
// creates by enabling a language nobody has translated yet.
const APP_DICTIONARIES: Record<string, Record<string, unknown>> = {
  en: { greeting: 'Hello', onlyInEnglish: 'English only' },
  pl: { greeting: 'Cześć' },
}

describe('dictionary fallback for locales the platform does not ship', () => {
  beforeEach(() => {
    clearRegisteredLocales()
    registerModules([] as any)
    registerAppDictionaryLoader(async (locale: Locale) => APP_DICTIONARIES[locale] ?? {})
    invalidateDictionaryCache()
  })

  afterEach(() => {
    clearRegisteredLocales()
    invalidateDictionaryCache()
  })

  describe('shipped locales keep their exact previous behaviour', () => {
    it('does not layer English underneath another shipped locale', async () => {
      const pl = await loadDictionary('pl')

      expect(pl).toEqual({ greeting: 'Cześć' })
      // The key that exists only in English must NOT leak into Polish — that
      // would be a behaviour change for locales that ship today.
      expect(pl).not.toHaveProperty('onlyInEnglish')
    })

    it('leaves the default locale itself untouched', async () => {
      await expect(loadDictionary('en')).resolves.toEqual({
        greeting: 'Hello',
        onlyInEnglish: 'English only',
      })
    })

    it('returns an empty dictionary for a shipped locale with no strings', async () => {
      await expect(loadDictionary('de')).resolves.toEqual({})
    })
  })

  describe('an app-registered locale', () => {
    it('falls back to the default locale instead of rendering raw keys', async () => {
      registerLocales(['cs'])

      await expect(loadDictionary('cs' as Locale)).resolves.toEqual({
        greeting: 'Hello',
        onlyInEnglish: 'English only',
      })
    })

    it('overlays its own translations on top of the default ones', async () => {
      registerLocales(['cs'])
      APP_DICTIONARIES.cs = { greeting: 'Ahoj' }

      try {
        await expect(loadDictionary('cs' as Locale)).resolves.toEqual({
          greeting: 'Ahoj',
          onlyInEnglish: 'English only',
        })
      } finally {
        delete APP_DICTIONARIES.cs
      }
    })

    it('lets module translations win over the default-locale base layer', async () => {
      registerLocales(['cs'])
      registerModules([{ translations: { cs: { greeting: 'Ahoj z modulu' } } }] as any)

      const cs = await loadDictionary('cs' as Locale)

      expect(cs.greeting).toBe('Ahoj z modulu')
      expect(cs.onlyInEnglish).toBe('English only')
    })

    it('is still memoized per locale', async () => {
      registerLocales(['cs'])

      const first = await loadDictionary('cs' as Locale)
      const second = await loadDictionary('cs' as Locale)

      expect(first).toBe(second)
    })

    it('does not mutate the default-locale dictionary it copies from', async () => {
      registerLocales(['cs'])
      APP_DICTIONARIES.cs = { greeting: 'Ahoj' }

      try {
        await loadDictionary('cs' as Locale)
        const en = await loadDictionary('en')

        expect(en.greeting).toBe('Hello')
      } finally {
        delete APP_DICTIONARIES.cs
      }
    })
  })
})
