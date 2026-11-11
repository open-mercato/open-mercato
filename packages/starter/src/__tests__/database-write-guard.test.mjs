import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { assertDatabaseWriteAllowed, resolveDatabaseWriteTarget, collectRemoteDatabaseFlags } from '../database-write-guard.mjs'
const pg = createRequire(import.meta.url)('pg')
const options = (url) => ({ projectDir: '/missing-fixture', env: { DATABASE_URL: url }, loadModule: () => pg })

test('local reuse remains automatic without an explicit service flag', async () => {
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
    const result = await assertDatabaseWriteAllowed({ ...options(`postgres://fixture:secret@${host}:5432/app`), input: {}, output: {} })
    assert.equal(result.remote, false)
  }
})

test('remote writes fail closed without an exact-target acknowledgment and never reveal credentials', async () => {
  const configuration = options('postgres://owner:fixture-secret@staging.example:6543/app?application_name=query-secret')
  for (const argv of [[], ['--allow-remote-database'], ['--allow-remote-database=other.example:6543/app'], ['--allow-remote-database=staging.example:6543/other']]) {
    await assert.rejects(assertDatabaseWriteAllowed({ ...configuration, argv, input: {}, output: {} }), error => {
      assert.match(error.message, /Remote database writes are blocked for staging\.example:6543\/app/)
      assert.ok(!error.message.includes('fixture-secret')); assert.ok(!error.message.includes('query-secret')); return true
    })
  }
  const accepted = await assertDatabaseWriteAllowed({ ...configuration, argv: ['--allow-remote-database=staging.example:6543/app'], input: {}, output: {} })
  assert.equal(accepted.argument, '--allow-remote-database=staging.example:6543/app')
  assert.equal(accepted.connectionEnv.DATABASE_URL, configuration.env.DATABASE_URL)
})

test('acknowledgment uses real pg connection parameters including URL query overrides', async () => {
  const configuration = options('postgres://fixture:secret@localhost:5432/local?host=production.example&port=6544&database=actual_db')
  const target = resolveDatabaseWriteTarget(configuration)
  assert.equal(target.remote, true); assert.equal(target.target, 'production.example:6544/local')
  await assert.rejects(assertDatabaseWriteAllowed({ ...configuration, argv: ['--allow-remote-database=localhost:5432/local'] }), /blocked/)
  const result = await assertDatabaseWriteAllowed({ ...configuration, argv: ['--allow-remote-database=production.example:6544/local'] })
  const parameters = new pg.Client({ ...result.connectionEnv, connectionString: result.connectionEnv.DATABASE_URL }).connectionParameters
  assert.equal(parameters.host, 'production.example'); assert.equal(parameters.port, 6544); assert.equal(parameters.database, 'local')
})

test('TTY boolean flag requires typing the exact target', async () => {
  const input = new PassThrough(); input.isTTY = true
  const output = new PassThrough(); output.isTTY = true
  const pending = assertDatabaseWriteAllowed({ ...options('postgres://fixture:secret@staging.example/app'), argv: ['--allow-remote-database'], input, output })
  setTimeout(() => input.write('staging.example:5432/app\n'), 5)
  const result = await pending
  assert.equal(result.target, 'staging.example:5432/app')
  input.end(); output.end()
})

test('accepted target captures a connection snapshot instead of reloading edited .env before child writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-write-guard-'))
  try {
    const file = path.join(dir, '.env'); const original = 'postgres://fixture:secret@staging.example:6543/app'
    fs.writeFileSync(file, `DATABASE_URL=${original}\n`)
    const result = await assertDatabaseWriteAllowed({ projectDir: dir, env: {}, loadModule: () => pg, argv: ['--allow-remote-database=staging.example:6543/app'] })
    fs.writeFileSync(file, 'DATABASE_URL=postgres://fixture:secret@production.example/other\n')
    const child = new pg.Client({ connectionString: result.connectionEnv.DATABASE_URL }).connectionParameters
    assert.equal(child.host, 'staging.example'); assert.equal(child.database, 'app'); assert.equal(child.port, 6543)
    assert.equal(result.connectionEnv.DATABASE_URL, original)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('shared guard mirrors are identical and parser retains only acknowledgment flags', () => {
  const source = fs.readFileSync(new URL('../database-write-guard.mjs', import.meta.url))
  for (const target of ['../../../../scripts/dev-database-write-guard.mjs', '../../../create-app/template/scripts/dev-database-write-guard.mjs']) assert.deepEqual(source, fs.readFileSync(new URL(target, import.meta.url)))
  assert.deepEqual(collectRemoteDatabaseFlags(['--reuse-services', '--allow-remote-database', 'host:5432/db', '--classic']), ['--allow-remote-database', 'host:5432/db'])
})

test('the actual starter database step blocks remote mutations before running any child command', async () => {
  const { databaseStep } = await import('../steps.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-write-'))
  try {
    fs.mkdirSync(path.join(dir, 'apps', 'mercato'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'apps', 'mercato', '.env'), 'DATABASE_URL=postgres://fixture:secret@staging.example/app\n')
    const commands = []
    const context = {
      repoRoot: dir, env: {}, flags: { noInfra: true }, log() {},
      assertDatabaseWriteAllowedImpl: options => assertDatabaseWriteAllowed({ ...options, loadModule: () => pg, input: {}, output: {} }),
      runStreamingImpl(_command, args) { commands.push(args); return 0 },
    }
    await assert.rejects(databaseStep.apply(context), /Remote database writes are blocked/)
    assert.deepEqual(commands, [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the starter passes the authorized immutable connection snapshot to migration and initialization children', async () => {
  const { databaseStep } = await import('../steps.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-snapshot-'))
  try {
    const app = path.join(dir, 'apps', 'mercato'); fs.mkdirSync(app, { recursive: true })
    const file = path.join(app, '.env'); const authorized = 'postgres://fixture:secret@staging.example:6543/app'
    fs.writeFileSync(file, `DATABASE_URL=${authorized}\n`)
    const commands = []
    const context = {
      repoRoot: dir, env: {}, flags: { noInfra: true, remoteDatabaseArgs: ['--allow-remote-database=staging.example:6543/app'] }, log() {},
      dbMarker: 'init-fixture', dbMigrationsMarker: 'migrations-fixture', migrationsFingerprint: 'fixture',
      assertDatabaseWriteAllowedImpl: options => assertDatabaseWriteAllowed({ ...options, loadModule: () => pg, input: {}, output: {} }),
      runStreamingImpl(_command, args, options) {
        commands.push({ args, databaseUrl: options.env.DATABASE_URL })
        fs.writeFileSync(file, 'DATABASE_URL=postgres://fixture:secret@production.example/unacknowledged\n')
        return 0
      },
    }
    await databaseStep.apply(context)
    assert.equal(commands.length, 2)
    assert.ok(commands.every(item => item.databaseUrl === authorized))
    assert.equal(context.remoteDatabaseArgument, '--allow-remote-database=staging.example:6543/app')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
