import type { Locale } from '../config'

// `detectLocale` reaches for `next/headers` through a dynamic import, so the
// mock has to be in place before the module under test is loaded.
const cookieStore = { value: undefined as string | undefined }
const headerStore = { acceptLanguage: '' }

jest.mock(
  'next/headers',
  () => ({
    cookies: async () => ({
      get: (name: string) =>
        name === 'locale' && cookieStore.value ? { value: cookieStore.value } : undefined,
    }),
    headers: async () => ({
      get: (name: string) =>
        name.toLowerCase() === 'accept-language' ? headerStore.acceptLanguage : null,
    }),
  }),
  { virtual: true },
)

import { detectLocale } from '../server'
import { clearRegisteredLocales, registerLocales } from '../locale-registry'

const NARROWED: readonly Locale[] = ['pl', 'de']

describe('detectLocale with a narrowed supported set', () => {
  beforeEach(() => {
    cookieStore.value = undefined
    headerStore.acceptLanguage = ''
    delete process.env.OM_FORCE_LOCALE
  })

  afterEach(() => {
    clearRegisteredLocales()
  })

  it('honours a cookie that is inside the narrowed set', async () => {
    cookieStore.value = 'de'

    await expect(detectLocale({ supportedLocales: NARROWED })).resolves.toBe('de')
  })

  it('ignores a cookie that the tenant has since deselected', async () => {
    cookieStore.value = 'es'
    headerStore.acceptLanguage = 'pl-PL,pl;q=0.9'

    await expect(detectLocale({ supportedLocales: NARROWED })).resolves.toBe('pl')
  })

  it('ignores an Accept-Language match outside the narrowed set', async () => {
    headerStore.acceptLanguage = 'es-ES,es;q=0.9'

    // `es` is a shipped locale, so `resolveLocaleFromAcceptLanguage` matches it;
    // the narrowed set is what rejects it.
    await expect(detectLocale({ supportedLocales: NARROWED })).resolves.not.toBe('es')
  })

  it('falls through to a lower-ranked header entry that is inside the set', async () => {
    // Header ranks `es` first, but the tenant does not serve it. Matching the
    // header against the process-wide set and re-checking afterwards would
    // discard the whole header on the `es` match and land on the default; the
    // narrowed set has to reach the matcher itself for `de` to win.
    headerStore.acceptLanguage = 'es-ES,es;q=0.9,de;q=0.8'

    await expect(detectLocale({ supportedLocales: NARROWED })).resolves.toBe('de')
  })

  it('never returns a locale outside the set it was given', async () => {
    // The regression this guards: the fallback used to be an unconditional
    // `return defaultLocale`, which rendered an English page under a switcher
    // offering only Polish and German.
    headerStore.acceptLanguage = 'en-US,en;q=0.9'

    const detected = await detectLocale({ supportedLocales: NARROWED })

    expect(NARROWED).toContain(detected)
  })

  it('falls back to the default locale when it is in the set', async () => {
    headerStore.acceptLanguage = 'fr-FR,fr;q=0.9'

    await expect(detectLocale({ supportedLocales: ['en', 'pl'] })).resolves.toBe('en')
  })

  it('keeps the previous behaviour when no set is passed', async () => {
    headerStore.acceptLanguage = 'es-ES,es;q=0.9'

    await expect(detectLocale()).resolves.toBe('es')
  })

  it('still lets OM_FORCE_LOCALE win over the narrowed set', async () => {
    process.env.OM_FORCE_LOCALE = 'ko'

    try {
      await expect(detectLocale({ supportedLocales: NARROWED })).resolves.toBe('ko')
    } finally {
      delete process.env.OM_FORCE_LOCALE
    }
  })

  it('detects a locale the app registered but the platform does not ship', async () => {
    registerLocales(['cs'])
    cookieStore.value = 'cs'

    await expect(detectLocale({ supportedLocales: ['en', 'cs'] as readonly Locale[] })).resolves.toBe('cs')
  })
})
