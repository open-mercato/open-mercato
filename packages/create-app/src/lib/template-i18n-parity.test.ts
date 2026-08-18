import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { SYNC_FOLDERS } from '../../../../scripts/template-sync.ts'

// App-level locale dictionaries carry every framework string a scaffold renders —
// `ui.*`, `appShell.*` and the app's module overrides. `packages/ui` calls them through
// `t(key, englishDefault)`, so a key missing from a scaffold's dictionary does not fail
// loudly: it silently falls back to the English default in every locale (#4738). The
// i18n gates in `scripts/` deliberately ignore `create-app/template/**`, so this test is
// the only thing standing between the two trees and silent drift.
//
// The mirror itself is produced by `yarn template:sync:fix`; failures here name the
// offending locale and are fixed by re-running it. Parity is compared on raw bytes, so
// a formatting-only divergence cannot parse equal and slip through; the key/value diff
// exists only to make the failure readable. The scope case widens SYNC_FOLDERS to
// `readonly string[]` on purpose — narrowing the real tuple should fail here with that
// assertion message, not as a type error in this file.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const I18N_REL = 'i18n'
const APP_I18N_ROOT = path.join(REPO_ROOT, 'apps', 'mercato', 'src', I18N_REL)
const TEMPLATE_I18N_ROOT = path.join(REPO_ROOT, 'packages', 'create-app', 'template', 'src', I18N_REL)

function collectLocaleFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
}

function readLocale(bytes: Buffer): Record<string, string> {
  return JSON.parse(bytes.toString('utf8')) as Record<string, string>
}

function describeDrift(file: string, appBytes: Buffer, templateBytes: Buffer): string {
  const app = readLocale(appBytes)
  const template = readLocale(templateBytes)

  const missingInTemplate = Object.keys(app).filter((key) => !(key in template))
  const extraInTemplate = Object.keys(template).filter((key) => !(key in app))
  const valueMismatches = Object.keys(app).filter((key) => key in template && app[key] !== template[key])

  const details: string[] = []
  if (missingInTemplate.length > 0) {
    details.push(`${missingInTemplate.length} key(s) missing from the template:\n  ${missingInTemplate.join('\n  ')}`)
  }
  if (extraInTemplate.length > 0) {
    details.push(`${extraInTemplate.length} key(s) present only in the template:\n  ${extraInTemplate.join('\n  ')}`)
  }
  if (valueMismatches.length > 0) {
    details.push(`${valueMismatches.length} value(s) differ from the app dictionary:\n  ${valueMismatches.join('\n  ')}`)
  }
  if (details.length === 0) {
    details.push(
      'the parsed dictionaries are equal, so the two files differ only in formatting (key order, indentation or trailing newline)',
    )
  }

  const appHash = createHash('sha256').update(appBytes).digest('hex').slice(0, 12)
  const templateHash = createHash('sha256').update(templateBytes).digest('hex').slice(0, 12)
  return `${file} (app ${appHash} vs template ${templateHash}): ${details.join('\n')}`
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
    const appBytes = fs.readFileSync(path.join(APP_I18N_ROOT, file))
    const templateBytes = fs.readFileSync(path.join(TEMPLATE_I18N_ROOT, file))
    if (appBytes.equals(templateBytes)) continue
    problems.push(describeDrift(file, appBytes, templateBytes))
  }

  assert.equal(
    problems.length,
    0,
    `Locale dictionaries drifted between app and template. Run \`yarn template:sync:fix\` to resync.\n\n${problems.join('\n\n')}`,
  )
})

test('template-sync keeps the i18n folder inside its mirror scope', () => {
  assert.ok(
    (SYNC_FOLDERS as readonly string[]).includes(I18N_REL),
    `SYNC_FOLDERS in scripts/template-sync.ts must include '${I18N_REL}' — dropping it stops \`yarn template:sync\` from noticing locale drift, which is how the scaffold's dictionaries fell 193 keys behind in #4738. Current scope: ${SYNC_FOLDERS.join(', ')}.`,
  )
})
