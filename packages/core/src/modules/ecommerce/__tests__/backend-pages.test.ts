import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { metadata as listMetadata } from '../backend/config/ecommerce/page.meta'
import { metadata as editMetadata } from '../backend/config/ecommerce/[id]/page.meta'

const locales = ['de', 'en', 'es', 'ko', 'pl']
const moduleRoot = join(__dirname, '..')

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(moduleRoot, 'i18n', `${locale}.json`), 'utf8'))
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('ecommerce backend pages', () => {
  it('lists the stores page in the settings hub behind ecommerce.stores.view', () => {
    expect(listMetadata.requireAuth).toBe(true)
    expect(listMetadata.requireFeatures).toEqual(['ecommerce.stores.view'])
    expect(listMetadata.pageContext).toBe('settings')
    expect(listMetadata.pageGroupKey).toBe('settings.sections.moduleConfigs')
    expect(listMetadata.icon).toBe('store')
  })

  it('keeps the store edit page out of navigation and behind the same view feature', () => {
    expect(editMetadata.requireFeatures).toEqual(['ecommerce.stores.view'])
    expect(editMetadata.navHidden).toBe(true)
    expect(editMetadata.breadcrumb[0]).toMatchObject({ href: '/backend/config/ecommerce' })
  })

  it('translates every backend admin key in all five locales', () => {
    const sources = [
      ...collectSourceFiles(join(moduleRoot, 'components')),
      ...collectSourceFiles(join(moduleRoot, 'backend')),
    ]
    const usedKeys = new Set<string>()
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/'(ecommerce\.(?:backend|module)\.[A-Za-z0-9_.]+)'/g)) usedKeys.add(match[1])
    }
    expect(usedKeys.size).toBeGreaterThan(40)
    for (const locale of locales) {
      const messages = readLocale(locale)
      const missing = [...usedKeys].filter((key) => !messages[key])
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })
})
