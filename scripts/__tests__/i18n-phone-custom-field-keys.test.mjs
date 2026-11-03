import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// `yarn i18n:check-usage` scans line by line (scripts/i18n-scanner.mjs), so a
// `t()` call whose key sits on its own line is invisible to it and its missing
// catalog entry never fails the gate. The phone definition editor has one such
// call (`ui.customFields.phone.defaultCountryHint`), which is why this file
// scans the source as a whole instead of per line.
const SOURCE = 'packages/ui/src/backend/fields/phone.tsx'

const LOCALES = ['en', 'pl', 'de', 'es']

const CATALOG_DIRS = [
  'apps/mercato/src/i18n',
  'packages/create-app/template/src/i18n',
]

const MULTILINE_CALL_PATTERN = /(?<![a-zA-Z_])(?:t|translate)\(\s*(['"])([a-zA-Z0-9_.]+)\1/g

const EXPECTED_KEYS = [
  'ui.customFields.phone.defaultCountry',
  'ui.customFields.phone.defaultCountryAuto',
  'ui.customFields.phone.defaultCountryHint',
]

function readSourceKeys() {
  const text = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8')
  return [...new Set([...text.matchAll(MULTILINE_CALL_PATTERN)].map((match) => match[2]))]
}

function readCatalog(dir, locale) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, dir, `${locale}.json`), 'utf8'))
}

test('the phone custom-field editor still references the keys this guard covers', () => {
  const keys = readSourceKeys()
  for (const key of EXPECTED_KEYS) {
    assert.ok(
      keys.includes(key),
      `${SOURCE} no longer references ${key} — update EXPECTED_KEYS so this guard keeps matching the source`
    )
  }
})

test('every translation key referenced by the phone custom-field editor is defined in all catalogs', () => {
  const keys = readSourceKeys()
  assert.ok(keys.length > 0, `no t() keys found in ${SOURCE}`)

  for (const dir of CATALOG_DIRS) {
    for (const locale of LOCALES) {
      const catalog = readCatalog(dir, locale)
      const missing = keys.filter((key) => typeof catalog[key] !== 'string' || catalog[key].length === 0)
      assert.deepEqual(
        missing,
        [],
        `${dir}/${locale}.json is missing phone custom-field keys: ${missing.join(', ')}`
      )
    }
  }
})

test('the app catalogs and the create-app template catalogs agree on the phone keys', () => {
  const keys = readSourceKeys()
  const [appDir, templateDir] = CATALOG_DIRS
  for (const locale of LOCALES) {
    const app = readCatalog(appDir, locale)
    const template = readCatalog(templateDir, locale)
    for (const key of keys) {
      assert.equal(
        template[key],
        app[key],
        `${templateDir}/${locale}.json must mirror ${appDir}/${locale}.json for ${key} (Template Sync Checklist)`
      )
    }
  }
})
