import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ISO_TABLE_PATH = path.join('packages', 'shared', 'src', 'lib', 'i18n', 'iso639.ts')

const CONFIG_SOURCE = "export const locales: Locale[] = ['en', 'pl']\nexport const defaultLocale: Locale = 'en'\n"

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-sync-'))
  createdRoots.push(root)
  for (const script of ['i18n-check-sync.ts', path.join('lib', 'i18n-locale-set.mjs')]) {
    writeFile(root, path.join('scripts', script), fs.readFileSync(path.join(REPO_ROOT, 'scripts', script)))
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction')
  writeFile(root, 'packages/shared/src/lib/i18n/config.ts', CONFIG_SOURCE)
  writeFile(root, ISO_TABLE_PATH, fs.readFileSync(path.join(REPO_ROOT, ISO_TABLE_PATH)))
  const dictionary = `${JSON.stringify({ 'records.title': 'Records' }, null, 2)}\n`
  writeFile(root, 'packages/core/src/modules/auth/i18n/en.json', dictionary)
  writeFile(root, 'packages/core/src/modules/auth/i18n/pl.json', dictionary)
  writeFile(root, 'apps/mercato/src/i18n/en.json', dictionary)
  writeFile(root, 'apps/mercato/src/i18n/xh.json', dictionary)
  writeFile(root, 'apps/mercato/src/i18n/faq.json', `${JSON.stringify({ question: 'Answer' }, null, 2)}\n`)
  writeFile(root, 'apps/mercato/src/i18n/app.json', `${JSON.stringify({ name: 'Mercato' }, null, 2)}\n`)
  writeFile(root, 'apps/mercato/src/modules/records/i18n/en.json', dictionary)
  writeFile(root, 'apps/mercato/src/modules/records/i18n/xh.json', dictionary)
  return root
}

function runSyncChecker(root) {
  const tsxCli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  return spawnSync(process.execPath, [tsxCli, path.join(root, 'scripts', 'i18n-check-sync.ts')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
}

test('the sync checker leaves unrelated app JSON files out of the app locale set', () => {
  const root = makeFixtureRepo()
  const result = runSyncChecker(root)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /apps\/mercato: en, xh\b/)
  assert.doesNotMatch(result.stdout, /faq|\bapp\.json/)
  assert.equal(fs.existsSync(path.join(root, 'apps', 'mercato', 'src', 'modules', 'records', 'i18n', 'faq.json')), false)
})

test('the sync checker keeps checking an app variant locale such as ca-valencia', () => {
  const root = makeFixtureRepo()
  const dictionary = `${JSON.stringify({ 'records.title': 'Records' }, null, 2)}\n`
  writeFile(root, 'apps/mercato/src/i18n/ca-valencia.json', dictionary)
  const result = runSyncChecker(root)
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /apps\/mercato: en, ca-valencia, xh\b/)
  assert.match(result.stdout, /\[app\/records\] MISSING FILES: ca-valencia\.json/)
})
