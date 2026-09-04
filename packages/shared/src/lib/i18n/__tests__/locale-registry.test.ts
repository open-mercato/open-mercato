import { defaultLocale, locales } from '../config'
import {
  clearRegisteredLocales,
  getRegisteredLocales,
  getSupportedLocales,
  isSupportedLocale,
  registerLocales,
  registerSupportedLocalesResolver,
  resolveSupportedLocalesForRequest,
} from '../locale-registry'
import { resolveSupportedLocale, resolveLocaleFromAcceptLanguage } from '../locale'

describe('locale registry', () => {
  afterEach(() => {
    clearRegisteredLocales()
    registerSupportedLocalesResolver(null)
  })

  describe('with nothing registered (regression guard)', () => {
    it('serves exactly the locales the platform ships, in order', () => {
      expect(getSupportedLocales()).toEqual(['en', 'pl', 'es', 'de', 'ko'])
      expect(defaultLocale).toBe('en')
    })

    it('returns the very same array instance as `locales`, so no copy can drift', () => {
      expect(getSupportedLocales()).toBe(locales)
    })

    it('rejects a locale the platform does not ship', () => {
      expect(isSupportedLocale('cs')).toBe(false)
      expect(resolveSupportedLocale('cs')).toBeNull()
    })
  })

  describe('registerLocales', () => {
    it('adds a locale the platform does not ship', () => {
      registerLocales(['cs'])

      expect(isSupportedLocale('cs')).toBe(true)
      expect(getSupportedLocales()).toEqual(['en', 'pl', 'es', 'de', 'ko', 'cs'])
    })

    it('keeps the shipped locales first so existing ordering is untouched', () => {
      registerLocales(['cs', 'fr'])

      expect(getSupportedLocales().slice(0, 5)).toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    it('normalizes case, whitespace and underscores', () => {
      registerLocales(['  CS  ', 'pt_BR'])

      expect(getRegisteredLocales()).toEqual(['cs', 'pt-br'])
    })

    it('is idempotent', () => {
      registerLocales(['cs'])
      registerLocales(['cs'])

      expect(getRegisteredLocales()).toEqual(['cs'])
    })

    it('ignores locales the platform already ships', () => {
      registerLocales(['en', 'pl'])

      expect(getRegisteredLocales()).toEqual([])
      expect(getSupportedLocales()).toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    it('ignores a code that is not a language, rather than throwing', () => {
      expect(() => registerLocales(['not-a-language', 'zzz', ''])).not.toThrow()
      expect(getRegisteredLocales()).toEqual([])
    })

    it('accepts a valid code even when a bad one is in the same batch', () => {
      registerLocales(['zzz', 'cs'])

      expect(getRegisteredLocales()).toEqual(['cs'])
    })
  })

  describe('integration with locale resolution', () => {
    it('makes a registered locale resolvable', () => {
      expect(resolveSupportedLocale('cs')).toBeNull()

      registerLocales(['cs'])

      expect(resolveSupportedLocale('cs')).toBe('cs')
    })

    it('folds a region subtag down to a registered base locale', () => {
      registerLocales(['cs'])

      expect(resolveSupportedLocale('cs-CZ')).toBe('cs')
    })

    it('picks a registered locale out of an Accept-Language header', () => {
      expect(resolveLocaleFromAcceptLanguage('cs-CZ,cs;q=0.9')).toBeNull()

      registerLocales(['cs'])

      expect(resolveLocaleFromAcceptLanguage('cs-CZ,cs;q=0.9')).toBe('cs')
    })

    it('still honours q-value ordering once extra locales exist', () => {
      registerLocales(['cs'])

      expect(resolveLocaleFromAcceptLanguage('cs;q=0.5,de;q=0.9')).toBe('de')
    })
  })

  describe('clearRegisteredLocales', () => {
    it('restores the shipped set', () => {
      registerLocales(['cs'])
      clearRegisteredLocales()

      expect(getSupportedLocales()).toEqual(['en', 'pl', 'es', 'de', 'ko'])
      expect(isSupportedLocale('cs')).toBe(false)
    })
  })

  describe('resolveSupportedLocalesForRequest', () => {
    it('serves the full set when no resolver is registered', async () => {
      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    it('narrows the served set to the tenant selection', async () => {
      registerSupportedLocalesResolver(async () => ['en', 'pl'])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl'])
    })

    it('preserves the platform ordering rather than the tenant ordering', async () => {
      registerSupportedLocalesResolver(async () => ['pl', 'en'])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl'])
    })

    it('serves a tenant-selected locale that the app registered', async () => {
      registerLocales(['cs'])
      registerSupportedLocalesResolver(async () => ['en', 'cs'])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'cs'])
    })

    it('drops a configured locale that has no dictionary source behind it', async () => {
      registerSupportedLocalesResolver(async () => ['en', 'cs'])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en'])
    })

    it('falls back to the full set when the selection matches nothing servable', async () => {
      registerSupportedLocalesResolver(async () => ['cs', 'fr'])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    it('treats "no stored selection" as no opinion', async () => {
      registerSupportedLocalesResolver(async () => null)

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    it('treats an empty selection as no opinion', async () => {
      registerSupportedLocalesResolver(async () => [])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    it('normalizes the configured codes before matching', async () => {
      registerSupportedLocalesResolver(async () => ['EN', ' pl '])

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl'])
    })

    it('never throws when the resolver fails — the root layout depends on it', async () => {
      registerSupportedLocalesResolver(async () => {
        throw new Error('database unavailable')
      })

      await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'es', 'de', 'ko'])
    })

    describe('keeping the default locale servable', () => {
      // `detectLocale` falls back to `defaultLocale` whenever neither the cookie
      // nor Accept-Language matches. If the served set could exclude it, the page
      // would render a language its own switcher does not list.
      it('keeps the default locale in a selection that omits it', async () => {
        registerSupportedLocalesResolver(async () => ['pl', 'de'])

        await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'de'])
      })

      it('keeps the platform ordering when it adds the default back', async () => {
        registerSupportedLocalesResolver(async () => ['ko', 'de'])

        await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'de', 'ko'])
      })

      it('does not duplicate the default locale when the selection includes it', async () => {
        registerSupportedLocalesResolver(async () => ['en', 'pl'])

        await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl'])
      })

      it('does not resurrect the default from a selection that matches nothing servable', async () => {
        // An entirely unservable selection is a typo, not an opinion: the full
        // set is the right answer, not a one-entry set containing only `en`.
        registerSupportedLocalesResolver(async () => ['cs', 'fr'])

        await expect(resolveSupportedLocalesForRequest()).resolves.toEqual(['en', 'pl', 'es', 'de', 'ko'])
      })

      it('always contains a locale `detectLocale` is allowed to return', async () => {
        registerLocales(['cs'])
        registerSupportedLocalesResolver(async () => ['pl', 'cs'])

        const served = await resolveSupportedLocalesForRequest()

        expect(served).toContain(defaultLocale)
      })
    })
  })

  describe('array identity', () => {
    // `useSupportedLocales()` hands this array straight to callers, so a fresh
    // identity on every call re-fires any `useEffect`/`useMemo` depending on it.
    it('is stable across calls once a locale is registered', () => {
      registerLocales(['cs'])

      expect(getSupportedLocales()).toBe(getSupportedLocales())
    })

    it('changes identity when the set actually changes', () => {
      const before = getSupportedLocales()
      registerLocales(['cs'])

      expect(getSupportedLocales()).not.toBe(before)
    })

    it('returns to the `locales` instance after clearing', () => {
      registerLocales(['cs'])
      clearRegisteredLocales()

      expect(getSupportedLocales()).toBe(locales)
    })
  })

  describe('isSupportedLocale normalization', () => {
    // `registerLocales` normalizes what it stores, so the membership test has to
    // normalize what it is asked about or the two disagree.
    it('accepts a shipped locale regardless of case and padding', () => {
      expect(isSupportedLocale('EN')).toBe(true)
      expect(isSupportedLocale('  pl  ')).toBe(true)
    })

    it('accepts the canonical BCP-47 form of a registered region locale', () => {
      registerLocales(['pt_BR'])

      expect(isSupportedLocale('pt-BR')).toBe(true)
      expect(isSupportedLocale('pt-br')).toBe(true)
    })

    it('still rejects a locale nobody registered', () => {
      expect(isSupportedLocale('CS')).toBe(false)
    })
  })
})
