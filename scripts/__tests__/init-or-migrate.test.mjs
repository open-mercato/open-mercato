import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scriptPath = path.join(repoRoot, 'docker/scripts/init-or-migrate.sh')
const templateScriptPath = path.join(repoRoot, 'packages/create-app/template/docker/scripts/init-or-migrate.sh')

function runScript({ seeded = false, initFails = false, initReportsExistingUsers = false, syncFails = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-or-migrate-'))
  const markerFile = path.join(tempDir, 'marker', '.seeded')
  const stepsFile = path.join(tempDir, 'steps.txt')

  if (seeded) {
    fs.mkdirSync(path.dirname(markerFile), { recursive: true })
    fs.writeFileSync(markerFile, '')
  }

  const record = (step) => `printf '%s\\n' ${step} >> ${JSON.stringify(stepsFile)}`
  const initCommand = initReportsExistingUsers
    ? `${record('init')}; echo 'Initialization aborted: found 3 existing user(s) in the database.'; exit 1`
    : initFails
      ? `${record('init')}; echo 'boom'; exit 1`
      : record('init')

  const result = spawnSync('sh', [scriptPath], {
    env: {
      ...process.env,
      INIT_MARKER_FILE: markerFile,
      INIT_COMMAND: initCommand,
      MIGRATE_COMMAND: record('migrate'),
      SYNC_ROLE_ACLS_COMMAND: syncFails ? `${record('sync')}; exit 1` : record('sync'),
    },
    encoding: 'utf8',
  })

  const steps = fs.existsSync(stepsFile)
    ? fs.readFileSync(stepsFile, 'utf8').split('\n').filter(Boolean)
    : []
  const markerExists = fs.existsSync(markerFile)

  fs.rmSync(tempDir, { recursive: true, force: true })

  return { markerExists, result, steps }
}

test('already-seeded run syncs role ACLs after migrating', () => {
  const { result, steps } = runScript({ seeded: true })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(steps, ['migrate', 'sync'])
})

test('first run leaves role ACLs to the initializer', () => {
  const { markerExists, result, steps } = runScript()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(steps, ['init'])
  assert.equal(markerExists, true)
})

test('recovery from an already-initialized database syncs role ACLs after migrating', () => {
  const { markerExists, result, steps } = runScript({ initReportsExistingUsers: true })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(steps, ['init', 'migrate', 'sync'])
  assert.equal(markerExists, true)
})

test('a failing role ACL sync warns without blocking startup', () => {
  const { result, steps } = runScript({ seeded: true, syncFails: true })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(steps, ['migrate', 'sync'])
  assert.match(result.stdout, /WARNING: role ACL sync failed/)
})

test('an initialization failure still aborts startup', () => {
  const { markerExists, result } = runScript({ initFails: true })

  assert.notEqual(result.status, 0)
  assert.equal(markerExists, false)
})

test('the create-app template ships the same boot script', () => {
  assert.equal(fs.readFileSync(templateScriptPath, 'utf8'), fs.readFileSync(scriptPath, 'utf8'))
})
