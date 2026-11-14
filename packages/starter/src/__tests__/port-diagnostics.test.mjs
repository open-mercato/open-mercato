import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  findPortProcessOwners,
  formatInfraProblem,
  parseListenerProcesses,
  requestExistingServicesConsent,
  startInfraServices,
  suggestFreePorts,
} from '../infra-preflight.mjs'

const service = { service: 'postgres', port: 5432, envKey: 'POSTGRES_PORT' }
const listener = { pid: 1234, command: 'com.docker.backend' }
const problem = { code: 'port-conflict', ports: [{ ...service, processes: [listener], containerName: 'mercato-postgres' }] }

test('lsof listener records preserve host PIDs and process names without terminal controls', () => {
  assert.deepEqual(parseListenerProcesses('p1234\nccom.docker.backend\np321\ncnode\np321\ncnode\np0\ncignored\np42\nc\u001b[31munsafe\tname\n'), [
    listener, { pid: 321, command: 'node' }, { pid: 42, command: 'unsafe name' },
  ])
})

test('macOS listener discovery is a bounded read-only argument-array invocation', () => {
  let call
  assert.deepEqual(findPortProcessOwners(5432, { platform: 'darwin', spawnSyncImpl: (command, args, options) => {
    call = { command, args, options }
    return { status: 0, stdout: 'p1234\nccom.docker.backend\n' }
  } }), [listener])
  assert.equal(call.command, 'lsof')
  assert.deepEqual(call.args, ['-nP', '-iTCP:5432', '-sTCP:LISTEN', '-Fpc'])
  assert.equal(call.options.timeout, 2000)
  assert.equal(call.options.shell, undefined)
})

test('Linux falls back to ss and Windows reads structured owning-process IDs', () => {
  const commands = []
  const linux = findPortProcessOwners(5432, { platform: 'linux', spawnSyncImpl: (command) => {
    commands.push(command)
    return command === 'lsof' ? { error: { code: 'ENOENT' } } : { status: 0, stdout: 'LISTEN 0 128 0.0.0.0:5432 0.0.0.0:* users:(("postgres",pid=987,fd=7))' }
  } })
  assert.deepEqual(commands, ['lsof', 'ss'])
  assert.deepEqual(linux, [{ pid: 987, command: 'postgres' }])
  const windows = findPortProcessOwners(5432, { platform: 'win32', spawnSyncImpl: (command, args) => {
    assert.equal(command, 'powershell.exe')
    assert.ok(args.includes('-NonInteractive'))
    assert.match(args.at(-1), /Get-NetTCPConnection -State Listen -LocalPort 5432/)
    return { status: 0, stdout: '{"pid":456,"command":"postgres"}' }
  } })
  assert.deepEqual(windows, [{ pid: 456, command: 'postgres' }])
})

test('missing permissions, invalid ports and malformed process output never block diagnosis', () => {
  for (const port of [0, -1, 65536, '5432', '1;kill']) {
    assert.deepEqual(findPortProcessOwners(port, { spawnSyncImpl: () => assert.fail('invalid port must not execute') }), [])
  }
  assert.deepEqual(findPortProcessOwners(5432, { platform: 'darwin', spawnSyncImpl: () => { throw new Error('permission denied') } }), [])
  assert.deepEqual(parseListenerProcesses('not JSON', { format: 'powershell' }), [])
})

test('conflict preflight attaches host listener PIDs without running compose up or image preparation', async () => {
  const calls = []
  const result = await startInfraServices({
    services: [service], composeArgs: (extra) => ['compose', ...extra], detect: () => ({ ok: true }),
    spawnSyncImpl: (_command, args) => { calls.push(args); return { status: 0, stdout: '[]' } },
    containerProbe: () => [{ ...service, containerName: 'previous-postgres', state: 'running' }],
    processProbe: () => [listener], portProbe: async () => true,
    beforeUp: () => assert.fail('must not prepare or mutate containers'), log: () => {},
  })
  assert.deepEqual(result.problem.ports[0].processes, [listener])
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes('ps'))
})

test('conflicts render separated listener, service/port and environment guidance in plain logs', () => {
  const lines = formatInfraProblem(problem, { output: { isTTY: false }, env: {} })
  const output = lines.join('\n')
  assert.match(output, /Port 5432 \(postgres\) is already in use\./)
  assert.match(output, /Listener PID: 1234 \(com\.docker\.backend\); container: mercato-postgres/)
  assert.match(output, /POSTGRES_PORT in \.env/)
  assert.ok(lines.includes(''))
  assert.doesNotMatch(output, /\u001b\[/)
  const unknown = formatInfraProblem({ code: 'port-conflict', ports: [service] }, { output: { isTTY: false }, env: {} }).join('\n')
  assert.match(unknown, /Listener PID: unavailable/)
})

test('interactive diagnostics color service, port, variables and commands and honor NO_COLOR', () => {
  const options = { output: { isTTY: true }, env: { TERM: 'xterm-256color' } }
  const output = formatInfraProblem(problem, options).join('\n')
  assert.ok(output.includes('\u001b[36mpostgres\u001b[0m'))
  assert.ok(output.includes('\u001b[33m5432\u001b[0m'))
  assert.ok(output.includes('\u001b[35mPOSTGRES_PORT\u001b[0m'))
  assert.ok(output.includes('\u001b[32myarn setup --no-infra\u001b[0m'))
  assert.ok(output.includes('\u001b[32m`yarn om stop`\u001b[0m'))
  for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }]) assert.doesNotMatch(formatInfraProblem(problem, { ...options, env }).join('\n'), /\u001b\[/)
})

test('consent separates warning emojis and the continuing paragraph from the answer', async () => {
  const lines = []
  assert.equal(await requestExistingServicesConsent(problem, { input: { isTTY: true }, output: { isTTY: false }, env: {}, question: async () => 'y', log: (line) => lines.push(line) }), true)
  assert.ok(lines.some((line) => line.startsWith('   ❗ mercato-postgres')))
  const continuing = lines.findIndex((line) => line.includes('Continuing with'))
  assert.equal(lines[continuing - 1], '')
  assert.ok(lines[continuing].startsWith('   ❗ '))
  assert.match(lines.join('\n'), /Listener PID: 1234/)
})

test('standalone preflight stays byte-identical to the shared starter implementation', () => {
  assert.deepEqual(fs.readFileSync(new URL('../infra-preflight.mjs', import.meta.url)), fs.readFileSync(new URL('../../../create-app/template/scripts/dev-infra-preflight.mjs', import.meta.url)))
})

test('port conflicts suggest the next free port, skipping taken ones and ports suggested for another service', async () => {
  const taken = new Set([5433, 6380])
  const suggested = await suggestFreePorts(
    [{ service: 'postgres', envKey: 'POSTGRES_PORT', port: 5432 }, { service: 'redis', envKey: 'REDIS_PORT', port: 6379 }],
    { probe: async (port) => taken.has(port), reserved: [5432, 6379, 5435] },
  )
  assert.deepEqual(suggested.map((entry) => entry.suggestedPort), [5434, 6381])
  const skipped = await suggestFreePorts([{ service: 'postgres', envKey: 'POSTGRES_PORT', port: 5432 }], { probe: async () => false, reserved: [5433] })
  assert.equal(skipped[0].suggestedPort, 5434, 'a port configured for another service in the stack is never suggested')
  const text = formatInfraProblem({ code: 'port-conflict', ports: suggested }, { output: { isTTY: false }, env: {} }).join('\n')
  assert.match(text, /set POSTGRES_PORT=5434 in \.env/)
  assert.match(text, /\(:5432 -> :5434\)/)
})

test('a known container owner is named instead of an unavailable listener PID', () => {
  const text = formatInfraProblem({ code: 'port-conflict', ports: [{ ...service, containerName: 'other-checkout-postgres' }] }, { output: { isTTY: false }, env: {} }).join('\n')
  assert.match(text, /Container: other-checkout-postgres/)
  assert.doesNotMatch(text, /Listener PID: unavailable/)
})
