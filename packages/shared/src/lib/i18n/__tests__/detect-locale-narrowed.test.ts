import type { Locale } from '../config'

/**
 * `detectLocale` reaches for `next/headers` through a dynamic import, so the mock has to be in place before
 * the module under test is loaded.
 *
 * NOT `{ virtual: true }`, and that flag is this file's whole history. `next/headers` is a real, resolvable
 * file (`node_modules/next/headers.js`); `virtual` is for modules that do NOT exist, and registering a mock
 * that way under a name jest can also resolve normally let the dynamic import reach the real module instead.
 * Outside a request context the real `cookies()` throws, `detectLocale` swallows that by design, and detection
 * falls through to `supported[0]` — so four tests failed with a plausible-looking wrong locale (`pl` for `de`,
 * `en` for `es`) in roughly one folder run in forty, and passed every time the file ran alone.
 */
const cookieStore = { value: undefined as string | undefined }
const headerStore = { acceptLanguage: '' }
/** Proof that the mock is what was consulted — see the assertion in `afterEach`. */
const mockCalls = { cookies: 0, headers: 0 }
/** Cleared by the one case that returns before `detectLocale` ever looks at a request. */
let expectsRequestAccess = true

jest.mock('next/headers', () => ({
  cookies: async () => {
    mockCalls.cookies += 1
    return {
      get: (name: string) =>
        name === 'locale' && cookieStore.value ? { value: cookieStore.value } : undefined,
    }
  },
  headers: async () => {
    mockCalls.headers += 1
    return {
      get: (name: string) =>
        name.toLowerCase() === 'accept-language' ? headerStore.acceptLanguage : null,
    }
  },
}))

import { detectLocale } from '../server'
import { clearRegisteredLocales, registerLocales } from '../locale-registry'

const NARROWED: readonly Locale[] = ['pl', 'de']

describe('detectLocale with a narrowed supported set', () => {
  beforeEach(() => {
    cookieStore.value = undefined
    headerStore.acceptLanguage = ''
    delete process.env.OM_FORCE_LOCALE
    mockCalls.cookies = 0
    mockCalls.headers = 0
    expectsRequestAccess = true
    // Cleared going in as well as coming out: the registry is process-wide and other suites in this folder
    // write to it.
    clearRegisteredLocales()
  })

  afterEach(() => {
    /**
     * Every case but one reaches `next/headers`. If neither accessor was called, the mock was not what
     * `detectLocale` loaded — and this says so, instead of leaving a wrong-looking locale to be explained.
     */
    if (expectsRequestAccess) expect(mockCalls.cookies + mockCalls.headers).toBeGreaterThan(0)
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
    // The one case that returns before the request is consulted at all, which is the point of it.
    expectsRequestAccess = false
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
