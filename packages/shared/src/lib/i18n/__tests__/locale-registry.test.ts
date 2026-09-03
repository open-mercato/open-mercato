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
  })
})
