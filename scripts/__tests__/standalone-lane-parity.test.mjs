import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

const repository = new URL('../../', import.meta.url)
const read = (relativePath) => fs.readFileSync(new URL(relativePath, repository), 'utf8')

test('the snapshot runs the shared lifecycle against the exact published version', () => {
  const workflow = parse(read('.github/workflows/snapshot.yml'))
  assert.deepEqual(workflow.on, { push: { branches: ['main'] } })
  const steps = workflow.jobs['standalone-integration'].steps
  const runnerSteps = steps.filter((step) => step.run?.includes('scripts/ci/standalone-integration.mjs'))
  assert.equal(runnerSteps.length, 1)
  const runner = runnerSteps[0]
  assert.match(runner.run, /--source published/)
  assert.match(runner.run, /--suite full/)
  assert.match(runner.run, /--version "\$STANDALONE_VERSION"/)
  assert.equal(runner.env.STANDALONE_VERSION, '${{ needs.snapshot.outputs.snapshot_version }}')
  assert.ok(steps.findIndex((step) => step.name === 'Wait for npm registry propagation') < steps.indexOf(runner))
  assert.ok(steps.some((step) => step.with?.path?.includes('standalone-selection.json')))

  const lifecycle = read('scripts/ci/standalone-integration.mjs')
  assert.match(lifecycle, /run\('yarn', \['build'\], \{\s*cwd: appDir,\s*env: \{ \.\.\.appEnv, NODE_ENV: 'production'/)
})

test('snapshot workflow cannot reintroduce independent app and test settings', () => {
  const workflow = parse(read('.github/workflows/snapshot.yml'))
  for (const step of workflow.jobs['standalone-integration'].steps) {
    assert.doesNotMatch(step.run ?? '', /cat\s+>>?\s+\.env|PORT=3001 yarn start|yarn test:integration/)
    for (const key of ['SYSTEM_EMAIL_PROVIDER', 'CACHE_SQLITE_PATH', 'OM_TEST_APP_ROOT', 'JWT_SECRET']) {
      assert.ok(!(key in (step.env ?? {})), `${step.name} duplicates ${key}`)
    }
  }
})

test('local standalone parity runner consumes shared settings instead of an independent profile', () => {
  const source = read('scripts/test-create-app-integration.ts')
  assert.match(source, /createStandaloneIntegrationEnvironment\(\{/)
  assert.match(source, /writeStandaloneEnv\(appDir, appEnv\)/)
  assert.match(source, /\.\.\.testEnv/)
  assert.match(source, /\.\.\.appEnv/)
  assert.equal(source.match(/env: \{ \.\.\.appRuntimeEnv, NODE_ENV: 'production' \}/g)?.length, 2)
  assert.match(source, /waitForStandaloneApp\(\{\s*appDir,\s*env: appRuntimeEnv,/)
  assert.match(source, /onStarted: \(child\) => \{ standaloneProcess = child \}/)
  assert.match(source, /spawn\('yarn', \['start'\]/)
  assert.match(source, /database = await startStandaloneDatabase\(\{ onStarted:/)
  assert.match(source, /stopCommand: commandRunner\.stop/)
  assert.doesNotMatch(source, /runCommand\(/)
  assert.match(source, /stopDatabase\?\.\(\)/)
  assert.doesNotMatch(source, /'test:ephemeral'/)
  assert.doesNotMatch(source, /env: \{ \.\.\.integrationEnv, NODE_ENV: 'production' \}/)
  assert.doesNotMatch(source, /ci-standalone-test-jwt-secret|local-standalone-documents-collab|AUTO_SPAWN_WORKERS:/)
})

test('the shared CI lifecycle also cleans detached app servers on interruption', () => {
  const source = read('scripts/ci/standalone-integration.mjs')
  assert.match(source, /createStandaloneCleanup\(\{ stopCommand: commandRunner\.stop, stopServer,/)
  assert.match(source, /registerStandaloneCleanup\(cleanupRuntime\)/)
  assert.match(source, /await cleanupRuntime\(\)/)
  assert.match(source, /removeSignalHandlers\(\)/)
  assert.doesNotMatch(source, /spawnSync/)
})
