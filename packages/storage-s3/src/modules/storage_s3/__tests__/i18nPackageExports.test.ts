import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const packageRequire = createRequire(__filename)

describe('storage_s3 locale package exports', () => {
  it.each(['en', 'de', 'es', 'pl'] as const)('resolves the %s locale through the package export map', (locale) => {
    const localePath = packageRequire.resolve(`@open-mercato/storage-s3/modules/storage_s3/i18n/${locale}.json`)
    const translations = JSON.parse(readFileSync(localePath, 'utf8')) as Record<string, unknown>

    expect(translations['storage_s3.errors.unauthorized']).toEqual(expect.any(String))
  })
})
