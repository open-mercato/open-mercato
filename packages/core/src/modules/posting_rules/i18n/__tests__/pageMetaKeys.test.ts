// Every translation key a backend page.meta.ts references (title, group,
// breadcrumb) must exist in every locale, or the sidebar and breadcrumbs fall
// back to the English literal.
import { readFileSync, readdirSync, statSync } from 'node:fs'

const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

function listPageMetaFiles(dirUrl: URL): URL[] {
  return readdirSync(dirUrl).flatMap((name) => {
    const entryUrl = new URL(encodeURIComponent(name), dirUrl)
    if (statSync(entryUrl).isDirectory()) return listPageMetaFiles(new URL(`${encodeURIComponent(name)}/`, dirUrl))
    return name === 'page.meta.ts' ? [entryUrl] : []
  })
}

function referencedKeys(): string[] {
  const keys = new Set<string>()
  for (const fileUrl of listPageMetaFiles(new URL('../../backend/', import.meta.url))) {
    const source = readFileSync(fileUrl, 'utf8')
    for (const match of source.matchAll(/(?:pageTitleKey|pageGroupKey|labelKey)\s*:\s*'([^']+)'/g)) {
      keys.add(match[1])
    }
  }
  return [...keys].sort()
}

describe('posting_rules page metadata translation keys', () => {
  const keys = referencedKeys()

  it('finds the keys the pages reference', () => {
    expect(keys).toContain('posting_rules.nav.group')
  })

  it.each(LOCALES)('every referenced key exists in %s', (locale) => {
    const dictionary = JSON.parse(readFileSync(new URL(`../${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>
    expect(keys.filter((key) => !dictionary[key])).toEqual([])
  })
})
