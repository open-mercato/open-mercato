import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function readSource(relativeUrl: string): string {
  return fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')
}

test('standalone dictionary loader stays aligned with the main app locale-shard loader', () => {
  const templateSource = readSource('../../template/src/lib/i18n/register-dictionary-loader.ts')
  const appSource = readSource('../../../../apps/mercato/src/lib/i18n/register-dictionary-loader.ts')

  assert.equal(templateSource, appSource)
  assert.match(templateSource, /modules\.i18n\.loaders\.generated/)
  assert.doesNotMatch(templateSource, /modules\.i18n\.generated['"]/)
  assert.match(templateSource, /loadLocaleModules\(locale\)/)
  assert.match(templateSource, /registerLoadedLocaleModules\(locale, localeModules, registerLocaleModules\)/)
})

test('standalone dictionary loader preserves all supported app dictionary fallbacks', () => {
  const source = readSource('../../template/src/lib/i18n/register-dictionary-loader.ts')

  for (const locale of ['en', 'pl', 'es', 'de']) {
    assert.match(source, new RegExp(`case '${locale}':[\\s\\S]*?i18n/${locale}\\.json`))
  }
  assert.match(source, /default:[\s\S]*?i18n\/en\.json/)
})
