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

function runScript({
  seeded = false,
  encryptionRejected = false,
  encryptionRejectedAtSync = false,
  initFails = false,
  initReportsExistingUsers = false,
  syncFails = false,
  migrateFails = false,
  migrateExitCode = 1,
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-or-migrate-'))
  const markerFile = path.join(tempDir, 'marker', '.seeded')
  const stepsFile = path.join(tempDir, 'steps.txt')
  const copiedScript = path.join(tempDir, 'init-or-migrate.sh')
  fs.copyFileSync(scriptPath, copiedScript)
  fs.writeFileSync(path.join(tempDir, 'encryption-preflight.mjs'), `
    import { spawnSync } from 'node:child_process'
    if (process.env.TEST_ENCRYPTION_REJECTED === '1' || (process.env.TEST_ENCRYPTION_REJECTED_AT_SYNC === '1' && process.argv[3].includes('sync'))) { console.error('Encryption compatibility rejected'); process.exit(78) }
    const result = spawnSync('sh', ['-lc', process.argv[3]], { stdio: 'inherit', env: process.env })
    process.exit(result.status ?? 1)
  `)

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
  const migrateCommand = migrateFails
    ? `${record('migrate')}; exit ${migrateExitCode}`
    : record('migrate')

  const result = spawnSync('sh', [copiedScript], {
    env: {
      ...process.env,
      INIT_MARKER_FILE: markerFile,
      TEST_ENCRYPTION_REJECTED: encryptionRejected ? '1' : '0',
      TEST_ENCRYPTION_REJECTED_AT_SYNC: encryptionRejectedAtSync ? '1' : '0',
      INIT_COMMAND: initCommand,
      MIGRATE_COMMAND: migrateCommand,
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

test('a failing migration on an already-seeded run aborts startup with the migration exit status', () => {
  const { result, steps } = runScript({ seeded: true, migrateFails: true, migrateExitCode: 3 })

  assert.equal(result.status, 3, result.stderr)
  assert.deepEqual(steps, ['migrate'])
})

test('the create-app template ships the same boot script', () => {
  assert.equal(fs.readFileSync(templateScriptPath, 'utf8'), fs.readFileSync(scriptPath, 'utf8'))
})


test('container setup rejects incompatible encryption before initialize, migrate, ACL sync or marker writes', () => {
  for (const seeded of [false, true]) {
    const { result, steps, markerExists } = runScript({ seeded, encryptionRejected: true })
    assert.notEqual(result.status, 0)
    assert.deepEqual(steps, [])
    assert.equal(markerExists, seeded)
    assert.match(result.stdout, /Encryption compatibility rejected/)
  }
})


test('an encryption refusal before role ACL synchronization aborts startup instead of becoming a nonfatal sync warning', () => {
  const { result, steps } = runScript({ seeded: true, encryptionRejectedAtSync: true })
  assert.equal(result.status, 78)
  assert.deepEqual(steps, ['migrate'])
  assert.match(result.stdout, /Encryption compatibility rejected/)
})
