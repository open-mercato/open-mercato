import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { STANDALONE_SMOKE_SPECS, assertStandaloneSmokeCoverage, pinStandalonePackages, selectStandaloneSpecs, verifyStandalonePackages } from '../lib/standalone-pr-gate.mjs'
import { createStandaloneIntegrationEnvironment } from '../lib/standalone-integration-env.mjs'

const discovered = [
  ...STANDALONE_SMOKE_SPECS.map((specPath) => ({ path: specPath, moduleName: specPath.split('/')[5], requiredModules: [] })),
  { path: 'catalog-extra.spec.ts', moduleName: 'catalog', requiredModules: [] },
  { path: 'sales-dependent.spec.ts', moduleName: 'sales', requiredModules: ['catalog'] },
  { path: 'unrelated.spec.ts', moduleName: 'customers', requiredModules: [] },
]

test('affected module coverage includes dependent specs and always retains smoke tests', () => {
  const result = selectStandaloneSpecs(discovered, ['packages/core/src/modules/catalog/api/products.ts'], 'affected')
  for (const specPath of [...STANDALONE_SMOKE_SPECS, 'catalog-extra.spec.ts', 'sales-dependent.spec.ts']) {
    assert.ok(result.selected.includes(specPath))
  }
  assert.ok(!result.selected.includes('unrelated.spec.ts'))
  assert.equal(result.fullSuite, false)
})

test('shared infrastructure changes conservatively run every discovered test', () => {
  const result = selectStandaloneSpecs(discovered, ['packages/shared/src/lib/commands/command-bus.ts'], 'affected')
  assert.equal(result.selected.length, discovered.length)
  assert.equal(result.fullSuite, true)
})

test('missing smoke prerequisites and missing affected diff fail closed', () => {
  assert.throws(() => selectStandaloneSpecs(discovered.slice(1), [], 'smoke'), /Required standalone smoke spec/)
  assert.throws(() => selectStandaloneSpecs(discovered, [], 'affected'), /requires changed files/)
})

test('a nonempty Playwright report cannot hide a missing or skipped smoke test', () => {
  const specs = STANDALONE_SMOKE_SPECS.map((file) => ({ file, tests: [{ results: [{ status: 'passed' }] }] }))
  assert.doesNotThrow(() => assertStandaloneSmokeCoverage({ suites: [{ suites: [{ specs }] }] }, { executed: true }))
  assert.throws(() => assertStandaloneSmokeCoverage({ suites: [{ specs: specs.slice(1) }] }), /was not collected/)
  specs[0].tests[0].results[0].status = 'skipped'
  assert.doesNotThrow(() => assertStandaloneSmokeCoverage({ suites: [{ specs }] }))
  assert.throws(() => assertStandaloneSmokeCoverage({ suites: [{ specs }] }, { executed: true }), /did not execute successfully/)
})

test('local sources pin both root and transitive first-party requests', () => {
  const packages = ['@open-mercato/core', '@open-mercato/shared', '@open-mercato/enterprise'].map((name) => ({ name, tarball: `/tmp/${name.split('/')[1]}.tgz` }))
  const result = pinStandalonePackages({ dependencies: { '@open-mercato/core': '0.10.0', next: '16' } }, packages)
  assert.equal(result.dependencies['@open-mercato/core'], 'file:/tmp/core.tgz')
  assert.equal(result.resolutions['@open-mercato/shared'], 'file:/tmp/shared.tgz')
  assert.equal(result.dependencies.next, '16')
  assert.throws(() => pinStandalonePackages({ dependencies: { '@open-mercato/unknown': '0.10.0' } }, packages), /No PR package/)
})

test('package verification rejects registry content mixed into an otherwise local install', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-package-verification-'))
  try {
    const appDir = path.join(tempRoot, 'app')
    const packages = ['core', 'shared'].map((name) => {
      const sourceDir = path.join(tempRoot, name)
      const installedDir = path.join(appDir, 'node_modules', '@open-mercato', name)
      for (const directory of [sourceDir, installedDir]) {
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@open-mercato/${name}`, version: '0.10.0' }))
        fs.writeFileSync(path.join(directory, 'index.js'), 'export const builtFromPr = true\n')
      }
      return { name: `@open-mercato/${name}`, unpackedDir: sourceDir, installedDir }
    })
    assert.deepEqual(verifyStandalonePackages(appDir, packages), ['@open-mercato/core', '@open-mercato/shared'])
    const extraFile = path.join(packages[0].installedDir, 'registry-only.js')
    fs.writeFileSync(extraFile, 'export const unexpected = true\n')
    assert.throws(() => verifyStandalonePackages(appDir, packages), /absent from the PR tarball/)
    fs.rmSync(extraFile)
    fs.writeFileSync(path.join(packages[0].installedDir, 'index.js'), 'export const builtFromPr = false\n')
    assert.throws(() => verifyStandalonePackages(appDir, packages), /differs from the PR tarball/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('standalone app and test processes share external stores while collaboration opt-in stays server-only', () => {
  const { appEnv, testEnv } = createStandaloneIntegrationEnvironment({ appDir: '/tmp/app', repoRoot: '/repo', baseUrl: 'http://localhost:3001', databaseUrl: 'postgres://test' })
  assert.equal(appEnv.CACHE_SQLITE_PATH, testEnv.CACHE_SQLITE_PATH)
  assert.equal(appEnv.OM_TEST_EMAIL_CAPTURE_PATH, testEnv.OM_TEST_EMAIL_CAPTURE_PATH)
  assert.equal(appEnv.OM_DOCUMENTS_COLLAB_INTEGRATION, '1')
  assert.equal(testEnv.OM_DOCUMENTS_COLLAB_INTEGRATION, '')
  assert.equal(testEnv.AUTO_SPAWN_WORKERS, 'false')
  assert.equal(testEnv.SELF_SERVICE_ONBOARDING_ENABLED, '')
  assert.equal(testEnv.SYSTEM_EMAIL_PROVIDER, '')
})

test('standalone integration remains in the existing snapshot lane without an automatic PR job', () => {
  const workflowsRoot = new URL('../../.github/workflows/', import.meta.url)
  assert.equal(fs.existsSync(new URL('standalone-pr.yml', workflowsRoot)), false)
  const callers = fs.readdirSync(workflowsRoot).filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => fs.readFileSync(new URL(name, workflowsRoot), 'utf8').includes('scripts/ci/standalone-integration.mjs'))
  assert.deepEqual(callers, ['snapshot.yml'])
  const snapshot = fs.readFileSync(new URL('snapshot.yml', workflowsRoot), 'utf8')
  assert.match(snapshot, /--source published/)
  assert.match(snapshot, /--suite full/)
})
