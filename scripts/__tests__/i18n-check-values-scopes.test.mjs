import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const CONFIG_SOURCE = "export const locales: Locale[] = ['en', 'pl', 'es', 'de', 'ko']\nexport const defaultLocale: Locale = 'en'\n"

const createdRoots = []

test.after(() => {
  for (const root of createdRoots) fs.rmSync(root, { recursive: true, force: true })
})

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

function makeFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-values-'))
  createdRoots.push(root)
  for (const script of ['i18n-check-values.mjs', 'i18n-values-scanner.mjs', path.join('lib', 'i18n-locale-set.mjs')]) {
    writeFile(root, path.join('scripts', script), fs.readFileSync(path.join(REPO_ROOT, 'scripts', script)))
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction')
  writeFile(root, 'packages/shared/src/lib/i18n/config.ts', CONFIG_SOURCE)
  const platformDictionary = JSON.stringify({ 'auth.title': 'Sign in' })
  for (const locale of ['en', 'pl', 'es', 'de', 'ko']) {
    writeFile(root, `packages/core/src/modules/auth/i18n/${locale}.json`, platformDictionary)
  }
  const appDictionary = JSON.stringify({ 'records.title': 'Records' })
  writeFile(root, 'apps/mercato/src/i18n/en.json', appDictionary)
  writeFile(root, 'apps/mercato/src/i18n/xh.json', appDictionary)
  writeFile(root, 'apps/mercato/src/modules/records/i18n/en.json', appDictionary)
  writeFile(root, 'apps/mercato/src/modules/records/i18n/xh.json', appDictionary)
  return root
}

function runValuesChecker(root, args) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'i18n-check-values.mjs'), '--json', ...args], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  return {
    modulesProcessed: report.modulesProcessed,
    locales: report.locales.map((entry) => entry.locale),
    modulesByLocale: Object.fromEntries(report.locales.map((entry) => [entry.locale, entry.perModule.length])),
  }
}

test('--module on a platform module reports only platform locales, not an app-only locale', () => {
  const root = makeFixtureRepo()
  const report = runValuesChecker(root, ['--module', 'auth'])
  assert.equal(report.modulesProcessed, 1)
  assert.deepEqual(report.locales, ['pl', 'es', 'de', 'ko'])
})

test('--module on an app module reports only that app\'s locales', () => {
  const root = makeFixtureRepo()
  const report = runValuesChecker(root, ['--module', 'records'])
  assert.equal(report.modulesProcessed, 1)
  assert.deepEqual(report.locales, ['xh'])
})

test('without --module the report covers both scopes, each locale only for its own modules', () => {
  const root = makeFixtureRepo()
  const report = runValuesChecker(root, [])
  assert.equal(report.modulesProcessed, 3)
  assert.deepEqual([...report.locales].sort(), ['de', 'es', 'ko', 'pl', 'xh'])
  assert.equal(report.modulesByLocale.xh, 2)
  assert.equal(report.modulesByLocale.pl, 1)
})
