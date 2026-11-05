/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (key: string) => `translated:${key}`,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => null })),
}))

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const LOCALES = ['en', 'de', 'es', 'ko', 'pl'] as const

const apiDir = path.join(__dirname, '..', 'api')
const i18nDir = path.join(__dirname, '..', 'i18n')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

function localeDictionary(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(i18nDir, `${locale}.json`), 'utf8')) as Record<string, string>
}

const sources = routeFiles(apiDir).map((file) => ({
  file: path.relative(apiDir, file),
  source: readFileSync(file, 'utf8'),
}))

const dictionaries = Object.fromEntries(LOCALES.map((locale) => [locale, localeDictionary(locale)]))

describe('storage_s3 route error localization (#4830)', () => {
  const usages = sources.flatMap(({ file, source }) =>
    [...source.matchAll(/t\('(storage_s3\.errors\.[a-zA-Z]+)', '([^']*)'\)/g)].map((match) => ({
      file,
      key: match[1],
      fallback: match[2],
    })),
  )

  it('uses translation keys in every route that reports an error', () => {
    expect(usages.length).toBeGreaterThan(0)
  })

  it('ships every key the routes use in all five supported locales', () => {
    const missing = usages.flatMap(({ key }) =>
      LOCALES.filter((locale) => dictionaries[locale][key] === undefined).map((locale) => `${locale}:${key}`),
    )
    expect(missing).toEqual([])
  })

  it('keeps each inline English fallback identical to en.json', () => {
    const drifted = usages
      .filter(({ key, fallback }) => dictionaries.en[key] !== fallback)
      .map(({ file, key }) => `${file}:${key}`)
    expect(drifted).toEqual([])
  })

  it('never returns a hardcoded user-facing error string from a route response', () => {
    // #4076 added the atomic quota-admission paths on top of an already localized
    // module and reintroduced hardcoded English, which is how this issue came back.
    const hardcoded = sources.flatMap(({ file, source }) =>
      [...source.matchAll(/error: '([^']+)'/g)].map((match) => `${file}: ${match[1]}`),
    )
    expect(hardcoded).toEqual([])
  })

  it('marks diagnostic-only thrown errors with the [internal] opt-out marker', () => {
    const unmarked = sources.flatMap(({ file, source }) =>
      [...source.matchAll(/throw new \w*Error\('([^']+)'\)/g)]
        .map((match) => match[1])
        .filter((message) => !message.startsWith('[internal] '))
        .map((message) => `${file}: ${message}`),
    )
    expect(unmarked).toEqual([])
  })

  it('returns the translated string, not the English literal, when the upload token is missing', async () => {
    const { PUT } = await import('../api/put/storage-providers/s3/signed-upload/[token]')
    const response = await PUT(
      new Request('http://localhost/api/storage-providers/s3/signed-upload/', { method: 'PUT' }),
      { params: { token: '  ' } },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:storage_s3.errors.uploadTokenRequired',
    })
  })

  it('returns the translated string when the quota service is not registered', async () => {
    const { PUT } = await import('../api/put/storage-providers/s3/signed-upload/[token]')
    const response = await PUT(
      new Request('http://localhost/api/storage-providers/s3/signed-upload/tok', { method: 'PUT' }),
      { params: { token: 'tok' } },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:storage_s3.errors.quotaUnavailable',
    })
  })
})
