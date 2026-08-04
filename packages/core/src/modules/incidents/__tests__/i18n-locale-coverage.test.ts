/** @jest-environment node */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type LocaleMap = Record<string, string>

type LocaleCoverageAllowlist = {
  identicalAllowed?: string[]
}

const i18nDir = join(__dirname, '..', 'i18n')
const checkedLocales = ['pl', 'de', 'es'] as const

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(i18nDir, fileName), 'utf8')) as T
}

function sortedKeys(locale: LocaleMap): string[] {
  return Object.keys(locale).sort((a, b) => a.localeCompare(b))
}

function difference(left: string[], right: Set<string>): string[] {
  return left.filter((key) => !right.has(key))
}

describe('incidents locale coverage', () => {
  const en = readJson<LocaleMap>('en.json')
  const enKeys = sortedKeys(en)
  const enKeySet = new Set(enKeys)
  const allowlist = new Set(readJson<LocaleCoverageAllowlist>('.locale-coverage-allowlist.json').identicalAllowed ?? [])

  it.each(checkedLocales)('%s has the same keys as en', (locale) => {
    const translated = readJson<LocaleMap>(`${locale}.json`)
    const translatedKeys = sortedKeys(translated)
    const translatedKeySet = new Set(translatedKeys)

    const missing = difference(enKeys, translatedKeySet)
    const extra = difference(translatedKeys, enKeySet)

    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it.each(checkedLocales)('%s does not fall back to English values outside the allowlist', (locale) => {
    const translated = readJson<LocaleMap>(`${locale}.json`)
    const identical = enKeys.filter((key) => translated[key] === en[key] && !allowlist.has(key))

    expect(identical).toEqual([])
  })

  it('every incidents.* key referenced in module code exists in en.json', () => {
    const moduleDir = join(__dirname, '..')
    const usedKeys = new Set<string>()
    const keyPattern = /(?:translate|\bt)\(\s*['"](incidents\.[A-Za-z0-9_.]+)['"]|(?:labelKey|titleKey|pageTitleKey|pageGroupKey|descriptionKey)\s*:\s*['"](incidents\.[A-Za-z0-9_.]+)['"]/g
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === '__integration__' || entry.name === 'i18n') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(full, 'utf8')
          for (const match of source.matchAll(keyPattern)) {
            const key = match[1] ?? match[2]
            if (key) usedKeys.add(key)
          }
        }
      }
    }
    walk(moduleDir)

    const missing = [...usedKeys].filter((key) => !enKeySet.has(key)).sort((a, b) => a.localeCompare(b))
    expect(missing).toEqual([])
  })
})
