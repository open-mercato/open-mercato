import * as path from 'path'
import * as fs from 'fs'

const i18nDir = path.resolve(__dirname, '../i18n')
const backendDir = path.resolve(__dirname, '../backend')

function loadJson(filePath: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function collectPageMetaFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectPageMetaFiles(fullPath))
    } else if (entry.name === 'page.meta.ts') {
      results.push(fullPath)
    }
  }
  return results
}

const en = loadJson(path.join(i18nDir, 'en.json'))
const pl = loadJson(path.join(i18nDir, 'pl.json'))
const de = loadJson(path.join(i18nDir, 'de.json'))
const es = loadJson(path.join(i18nDir, 'es.json'))
const enKeys = new Set(Object.keys(en))

describe('business_rules i18n', () => {
  describe('locale key parity', () => {
    const locales = { pl, de, es }

    for (const [locale, data] of Object.entries(locales)) {
      it(`${locale}.json has all keys from en.json`, () => {
        const missing = [...enKeys].filter((k) => !(k in data))
        expect(missing).toEqual([])
      })

      it(`${locale}.json has no extra keys missing from en.json`, () => {
        const extra = Object.keys(data).filter((k) => !enKeys.has(k))
        expect(extra).toEqual([])
      })
    }
  })

  describe('locale values', () => {
    it('en.json has no empty translation values', () => {
      const empty = Object.entries(en)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k)
      expect(empty).toEqual([])
    })
  })

  describe('page.meta.ts i18n keys exist in en.json', () => {
    const metaFiles = collectPageMetaFiles(backendDir)

    for (const filePath of metaFiles) {
      const relative = path.relative(backendDir, filePath)

      it(`${relative} — all labelKey/pageTitleKey/pageGroupKey exist in en.json`, () => {
        const content = fs.readFileSync(filePath, 'utf-8')
        const keyPattern = /(?:labelKey|pageTitleKey|pageGroupKey):\s*['"]([^'"]+)['"]/g
        const referencedKeys: string[] = []
        let match
        while ((match = keyPattern.exec(content)) !== null) {
          referencedKeys.push(match[1])
        }

        const missing = referencedKeys.filter((k) => !enKeys.has(k))
        expect(missing).toEqual([])
      })
    }
  })

  describe('page.meta.ts ACL features are declared in acl.ts', () => {
    const { features } = require('../acl')
    const declaredFeatureIds = new Set(
      features.map((f: { id: string }) => f.id),
    )
    // Wildcard: business_rules.* covers all sub-features
    const metaFiles = collectPageMetaFiles(backendDir)

    for (const filePath of metaFiles) {
      const relative = path.relative(backendDir, filePath)

      it(`${relative} — requireFeatures reference declared ACL features`, () => {
        const content = fs.readFileSync(filePath, 'utf-8')
        const featPattern = /requireFeatures:\s*\[([^\]]+)\]/
        const featMatch = content.match(featPattern)
        if (!featMatch) return

        const featureRefs = featMatch[1]
          .match(/['"]([^'"]+)['"]/g)
          ?.map((s) => s.replace(/['"]/g, '')) ?? []

        const undeclared = featureRefs.filter((f) => !declaredFeatureIds.has(f))
        expect(undeclared).toEqual([])
      })
    }
  })
})
