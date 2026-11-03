import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findContainerPortOwners, requestExistingServicesConsent, startInfraServices } from '../infra-preflight.mjs'
import { devRuntimeArgs } from '../infra.mjs'
import { infraUpStep, runSteps } from '../steps.mjs'
import { ensureInfra } from '../../../create-app/template/scripts/infra.mjs'

const SERVICES = [
  { service: 'postgres', port: 5432, envKey: 'POSTGRES_PORT' },
  { service: 'redis', port: 6379, envKey: 'REDIS_PORT' },
]

function fakeContainerScan(entries) {
  const calls = []
  const spawnSyncImpl = (command, args) => {
    calls.push({ command, args })
    if (args[0] === 'ps') return { status: 0, stdout: entries.map((_, index) => index.toString(16).padStart(12, '0')).join('\n') }
    if (args[0] === 'inspect') return { status: 0, stdout: entries.map((entry) => JSON.stringify(entry)).join('\n') }
    throw new Error(`Unexpected Docker command: ${args[0]}`)
  }
  return { calls, spawnSyncImpl }
}

function owner(overrides = {}) {
  return {
    ...SERVICES[0],
    containerName: 'mercato-postgres',
    state: 'running',
    health: 'healthy',
    ...overrides,
  }
}

function conflict(ports = [owner()]) {
  return { code: 'port-conflict', ports }
}

test('container discovery finds published port owners across Compose project identities without mutating Docker', () => {
  const fake = fakeContainerScan([
    { name: '/previous-postgres', status: 'running', health: 'healthy', ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] } },
    { name: '/unrelated-postgres', status: 'running', health: 'healthy', ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55432' }] } },
    { name: '/stopped-redis', status: 'exited', health: '', ports: { '6379/tcp': [{ HostIp: '0.0.0.0', HostPort: '6379' }] } },
  ])

  const found = findContainerPortOwners(SERVICES, fake)

  assert.deepEqual(found, [owner({ containerName: 'previous-postgres' })])
  assert.deepEqual(fake.calls.map(({ args }) => args[0]), ['ps', 'inspect'])
  assert.ok(fake.calls[0].args.includes('status=running'))
  assert.ok(fake.calls[0].args.includes('status=restarting'))
  assert.ok(fake.calls[1].args.includes('--format'))
  assert.ok(fake.calls.every(({ command }) => command === 'docker'))
})

test('container discovery retains restarting owners and de-duplicates IPv4 and IPv6 bindings', () => {
  const fake = fakeContainerScan([
    { name: '/mercato-postgres', status: 'restarting', health: 'unhealthy', ports: { '5432/tcp': [
      { HostIp: '0.0.0.0', HostPort: '5432' },
      { HostIp: '::', HostPort: '5432' },
    ] } },
  ])

  assert.deepEqual(findContainerPortOwners(SERVICES, fake), [owner({ state: 'restarting', health: 'unhealthy' })])
})

test('container discovery does not infer an owner when Docker inspection fails', () => {
  const calls = []
  const found = findContainerPortOwners(SERVICES, {
    spawnSyncImpl: (command, args) => {
      calls.push(args[0])
      return args[0] === 'ps'
        ? { status: 0, stdout: 'abcdef123456\n' }
        : { status: 1, stdout: '', stderr: 'container disappeared' }
    },
  })

  assert.deepEqual(found, [])
  assert.deepEqual(calls, ['ps', 'inspect'])
})

test('restarting cross-project containers block startup even while their TCP port is briefly closed', async () => {
  const calls = []
  const restarting = owner({ state: 'restarting', health: 'unhealthy' })
  const outcome = await startInfraServices({
    services: SERVICES,
    composeArgs: (extra) => ['compose', ...extra],
    detect: () => ({ ok: true }),
    spawnSyncImpl: (command, args) => {
      calls.push(args)
      return { status: 0, stdout: '' }
    },
    portProbe: async () => false,
    containerProbe: () => [restarting],
    beforeUp: () => assert.fail('image preparation must not run while an existing container owns the port'),
    log: () => {},
  })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.problem.code, 'port-conflict')
  assert.deepEqual(outcome.problem.ports, [restarting])
  assert.ok(calls.every((args) => !args.includes('up') && !args.includes('stop') && !args.includes('down')))
})

test('running services in this Compose project do not become foreign port conflicts', async () => {
  const inspectedServices = []
  const outcome = await startInfraServices({
    services: SERVICES,
    composeArgs: (extra) => ['compose', ...extra],
    detect: () => ({ ok: true }),
    spawnSyncImpl: (command, args) => ({
      status: 0,
      stdout: args.includes('ps') ? JSON.stringify({ Service: 'postgres', State: 'running', Health: 'healthy' }) : '',
    }),
    portProbe: async () => false,
    containerProbe: (services) => {
      inspectedServices.push(...services)
      return []
    },
    log: () => {},
  })

  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.reused, ['postgres'])
  assert.ok(inspectedServices.every(({ service }) => service !== 'postgres'))
})

test('existing-services consent defaults to no and never prompts without an interactive terminal', async () => {
  const messages = []
  const question = async () => assert.fail('non-interactive setup must not prompt')
  const options = { question, log: (line) => messages.push(line) }

  assert.equal(await requestExistingServicesConsent(conflict(), { ...options, nonInteractive: true }), false)
  assert.equal(await requestExistingServicesConsent(conflict(), { input: { isTTY: false }, log: options.log }), false)
  assert.equal(await requestExistingServicesConsent(conflict(), { ...options, question: async () => '' }), false)
  assert.equal(await requestExistingServicesConsent(conflict(), { ...options, question: async () => 'no' }), false)
  assert.match(messages.join('\n'), /yarn om stop/)
})

test('existing-services consent requires explicit yes and discloses restarting or unhealthy containers', async () => {
  for (const answer of ['y', 'yes']) {
    const messages = []
    const accepted = await requestExistingServicesConsent(conflict([owner({ state: 'restarting', health: 'unhealthy' })]), {
      question: async () => answer,
      log: (line) => messages.push(line),
    })

    assert.equal(accepted, true)
    assert.match(messages.join('\n'), /mercato-postgres/)
    assert.match(messages.join('\n'), /restart|unhealthy/i)
    assert.match(messages.join('\n'), /yarn om stop/)
  }
})

test('accepted existing infrastructure continues setup without restarting it and forwards no-infra to dev', async () => {
  const calls = []
  const problem = conflict()
  const ctx = {
    repoRoot: '/repo',
    mode: 'hybrid',
    flags: { noInfra: false, nonInteractive: false, profiles: [] },
    log: () => {},
    runComposeImpl: () => ({ status: 0, stdout: '' }),
    startInfraImpl: async () => {
      calls.push('inspect-existing')
      return { ok: false, problem }
    },
    ensureOpencodeImageImpl: () => assert.fail('accepted existing infrastructure must not rebuild images'),
    confirmExistingServicesImpl: async (found) => {
      assert.deepEqual(found, problem)
      calls.push('consent')
      return true
    },
  }

  const outcome = await runSteps([
    infraUpStep,
    { id: 'continued', title: 'Continue setup', async apply() { calls.push('continue') } },
  ], ctx)

  assert.equal(outcome.ok, true)
  assert.equal(ctx.existingInfraAccepted, true)
  assert.equal(ctx.flags.noInfra, true)
  assert.deepEqual(calls, ['inspect-existing', 'consent', 'continue'])
  assert.deepEqual(devRuntimeArgs([], ctx.flags), ['--no-infra'])
})

test('declined infrastructure reuse stops setup and gives the non-destructive stop command', async () => {
  const messages = []
  const outcome = await runSteps([
    infraUpStep,
    { id: 'continued', title: 'Continue setup', async apply() { assert.fail('declined reuse must stop setup') } },
  ], {
    repoRoot: '/repo',
    mode: 'hybrid',
    flags: { noInfra: false, nonInteractive: true, profiles: [] },
    log: (line) => messages.push(line),
    runComposeImpl: () => ({ status: 0, stdout: '' }),
    startInfraImpl: async () => ({ ok: false, problem: conflict() }),
    confirmExistingServicesImpl: async () => false,
    ensureOpencodeImageImpl: () => assert.fail('declined reuse must not mutate images'),
  })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.failedStep, 'infra-up')
  assert.match(messages.join('\n'), /yarn om stop/)
})


test('standalone setup accepts existing services only after explicit confirmation', async () => {
  const problem = conflict([owner({ state: 'restarting', health: 'unhealthy' })])
  const calls = []
  const outcome = await ensureInfra({
    projectDir: '/missing-standalone-fixture',
    env: {},
    allowExistingServices: true,
    startImpl: async () => {
      calls.push('detect')
      return { ok: false, problem }
    },
    confirmExistingServices: async (found) => {
      assert.deepEqual(found, problem)
      calls.push('consent')
      return true
    },
    log: () => {},
    error: () => assert.fail('accepted services must not produce a setup failure'),
  })

  assert.deepEqual(outcome, { ok: true, existingServices: true })
  assert.deepEqual(calls, ['detect', 'consent'])
})

test('standalone setup preserves the conflict when reuse is declined or not enabled', async () => {
  for (const allowExistingServices of [true, false]) {
    let confirmations = 0
    const failure = { ok: false, problem: conflict() }
    const outcome = await ensureInfra({
      projectDir: '/missing-standalone-fixture',
      env: {},
      allowExistingServices,
      startImpl: async () => failure,
      confirmExistingServices: async () => {
        confirmations += 1
        return false
      },
      log: () => {},
      error: () => {},
    })

    assert.deepEqual(outcome, failure)
    assert.equal(confirmations, allowExistingServices ? 1 : 0)
    assert.equal(outcome.existingServices, undefined)
  }
})

test('standalone setup does not offer reuse for an unavailable Docker daemon', async () => {
  const failure = { ok: false, problem: { code: 'daemon-stopped', detail: 'engine unavailable' } }
  const outcome = await ensureInfra({
    projectDir: '/missing-standalone-fixture',
    env: {},
    allowExistingServices: true,
    startImpl: async () => failure,
    confirmExistingServices: async () => assert.fail('a runtime failure cannot authorize existing-service reuse'),
    log: () => {},
    error: () => {},
  })

  assert.deepEqual(outcome, failure)
})
