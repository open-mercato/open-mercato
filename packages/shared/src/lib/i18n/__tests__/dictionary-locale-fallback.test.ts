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

  describe('host app override precedence', () => {
    it('lets the host app dictionary override a module-defined key', async () => {
      registerModules([{ translations: { en: { greeting: 'Hello from module' } } }] as any)

      const en = await loadDictionary('en')

      // The host's own locale file must win — a module MUST NOT be able to
      // silently shadow a key the host app explicitly set (issue #5995).
      expect(en.greeting).toBe('Hello')
    })

    it('still falls back to a module key the host app does not define', async () => {
      registerModules([{ translations: { en: { moduleOnly: 'Module value' } } }] as any)

      const en = await loadDictionary('en')

      expect(en.moduleOnly).toBe('Module value')
      expect(en.greeting).toBe('Hello')
    })

    it('sees a module registered as a side effect of resolving the app loader on the first load of a locale', async () => {
      // Mirrors apps/mercato/src/lib/i18n/register-dictionary-loader.ts: the
      // registered loader lazily imports the locale's per-module translation
      // bundle and calls registerModules() as a side effect, after an internal
      // await. loadDictionary() MUST await loadAppDictionary() before reading
      // tryGetModules() — reading the registry first would race the locale's
      // first-ever load and permanently cache a dictionary missing this
      // lazily-registered module's translations (regression fixed in
      // 4f3a8e255).
      registerAppDictionaryLoader(async (locale: Locale) => {
        if (locale === 'pl') {
          await Promise.resolve()
          registerModules([
            { translations: { pl: { greeting: 'Cześć (module)', fromModule: 'Z modułu' } } },
          ] as any)
        }
        return APP_DICTIONARIES[locale] ?? {}
      })

      const pl = await loadDictionary('pl')

      // The module key is present on the very first load, proving the module
      // registered inside the loader was read after it resolved.
      expect(pl.fromModule).toBe('Z modułu')
      // The app dictionary still wins the collision (issue #5995).
      expect(pl.greeting).toBe('Cześć')
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
