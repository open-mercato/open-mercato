import fs from 'node:fs'
import path from 'node:path'

const moduleDir = path.join(__dirname, '..')
const i18nDir = path.join(moduleDir, 'i18n')
const skippedDirs = new Set(['__tests__', '__integration__', 'i18n', 'migrations'])

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) files.push(...collectSourceFiles(path.join(dir, entry.name)))
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path.join(dir, entry.name))
    }
  }
  return files
}

function collectErrorKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of collectSourceFiles(moduleDir)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/['"`](forms\.errors\.[a-z_]+)['"`]/g)) {
      keys.add(match[1])
    }
  }
  return keys
}

describe('forms error message keys (#7141)', () => {
  const keys = collectErrorKeys()

  it('collects the create-form key validation message', () => {
    expect(keys.has('forms.errors.invalid_key')).toBe(true)
  })

  it('defines every referenced error key in every locale file', () => {
    const locales = fs.readdirSync(i18nDir).filter((file) => file.endsWith('.json'))
    expect(locales.length).toBeGreaterThan(0)
    for (const locale of locales) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(i18nDir, locale), 'utf8')) as Record<string, string>
      const missing = [...keys].filter((key) => !dictionary[key] || dictionary[key] === key)
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })
})
