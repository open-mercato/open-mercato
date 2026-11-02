import assert from 'node:assert/strict'
import test from 'node:test'
import { startStandaloneDatabase } from '../lib/standalone-local-database.mjs'

const containerId = 'a'.repeat(64)

function dockerFixture({ portStatus = 0, readiness = [0] } = {}) {
  const calls = []
  const run = (args) => {
    calls.push(args)
    if (args[0] === 'run') return { status: 0, stdout: containerId }
    if (args[0] === 'port') return { status: portStatus, stdout: '127.0.0.1:51234\n' }
    if (args[0] === 'exec') return { status: readiness.shift() ?? 1, stdout: '' }
    if (args[0] === 'rm') return { status: 0, stdout: containerId }
    throw new Error('Unexpected docker command')
  }
  return { run, calls, wait: async () => {} }
}

test('local standalone database uses a disposable loopback port and explicit cleanup', async () => {
  const fixture = dockerFixture({ readiness: [1, 0] })
  const database = await startStandaloneDatabase(fixture)
  assert.equal(database.databaseUrl, 'postgres://mercato:secret@127.0.0.1:51234/mercato_test')
  assert.ok(fixture.calls[0].includes('127.0.0.1::5432'))
  assert.equal(fixture.calls.filter((args) => args[0] === 'exec').length, 2)
  database.stop()
  assert.deepEqual(fixture.calls.at(-1), ['rm', '--force', containerId])
})

test('partial database setup failure removes the container before rejecting', async () => {
  const fixture = dockerFixture({ portStatus: 1 })
  await assert.rejects(startStandaloneDatabase(fixture), /loopback port/)
  assert.deepEqual(fixture.calls.at(-1), ['rm', '--force', containerId])
})

test('database readiness timeout remains bounded and cleans up', async () => {
  const fixture = dockerFixture({ readiness: [1, 1] })
  await assert.rejects(startStandaloneDatabase({ ...fixture, attempts: 2 }), /did not become ready/)
  assert.equal(fixture.calls.filter((args) => args[0] === 'exec').length, 2)
  assert.deepEqual(fixture.calls.at(-1), ['rm', '--force', containerId])
})
