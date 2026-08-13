import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// App-level locale dictionaries carry every framework string a scaffold renders —
// `ui.*`, `appShell.*` and the app's module overrides. `packages/ui` calls them through
// `t(key, englishDefault)`, so a key missing from a scaffold's dictionary does not fail
// loudly: it silently falls back to the English default in every locale (#4738). The
// i18n gates in `scripts/` deliberately ignore `create-app/template/**`, so this test is
// the only thing standing between the two trees and silent drift.
//
// The mirror itself is produced by `yarn template:sync:fix`; failures here name the
// offending locale and are fixed by re-running it.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const I18N_REL = 'i18n'
const APP_I18N_ROOT = path.join(REPO_ROOT, 'apps', 'mercato', 'src', I18N_REL)
const TEMPLATE_I18N_ROOT = path.join(REPO_ROOT, 'packages', 'create-app', 'template', 'src', I18N_REL)
const TEMPLATE_SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'template-sync.ts')

function collectLocaleFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
}

function readLocale(root: string, file: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Record<string, string>
}

test('template ships a locale dictionary for every locale the app defines', () => {
  const appLocales = collectLocaleFiles(APP_I18N_ROOT)
  const templateLocales = collectLocaleFiles(TEMPLATE_I18N_ROOT)

  assert.ok(appLocales.length > 0, `No locale dictionaries found in apps/mercato/src/${I18N_REL}`)
  assert.deepEqual(
    templateLocales,
    appLocales,
    `Locale file lists differ. Run \`yarn template:sync:fix\` to mirror apps/mercato/src/${I18N_REL} into packages/create-app/template/src/${I18N_REL}.`,
  )
})

test('template locale dictionaries are byte-identical to the app dictionaries', () => {
  const problems: string[] = []

  for (const file of collectLocaleFiles(APP_I18N_ROOT)) {
    const app = readLocale(APP_I18N_ROOT, file)
    const template = readLocale(TEMPLATE_I18N_ROOT, file)

    const missingInTemplate = Object.keys(app).filter((key) => !(key in template))
    const extraInTemplate = Object.keys(template).filter((key) => !(key in app))
    const valueMismatches = Object.keys(app).filter((key) => key in template && app[key] !== template[key])

    if (missingInTemplate.length > 0) {
      problems.push(`${file}: ${missingInTemplate.length} key(s) missing from the template:\n  ${missingInTemplate.join('\n  ')}`)
    }
    if (extraInTemplate.length > 0) {
      problems.push(`${file}: ${extraInTemplate.length} key(s) present only in the template:\n  ${extraInTemplate.join('\n  ')}`)
    }
    if (valueMismatches.length > 0) {
      problems.push(`${file}: ${valueMismatches.length} value(s) differ from the app dictionary:\n  ${valueMismatches.join('\n  ')}`)
    }
  }

  assert.equal(
    problems.length,
    0,
    `Locale dictionaries drifted between app and template. Run \`yarn template:sync:fix\` to resync.\n\n${problems.join('\n\n')}`,
  )
})

test('template-sync keeps the i18n folder inside its mirror scope', () => {
  const source = fs.readFileSync(TEMPLATE_SYNC_SCRIPT, 'utf8')
  const declaration = /const SYNC_FOLDERS = \[([^\]]*)\]/.exec(source)

  assert.ok(declaration, 'Could not find the SYNC_FOLDERS declaration in scripts/template-sync.ts')
  assert.match(
    declaration[1],
    /'i18n'/,
    "SYNC_FOLDERS must include 'i18n' — dropping it stops `yarn template:sync` from noticing locale drift, which is how the scaffold's dictionaries fell 193 keys behind in #4738.",
  )
})
