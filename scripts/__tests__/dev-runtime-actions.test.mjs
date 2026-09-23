import test from 'node:test'
import assert from 'node:assert/strict'

import { createDevRuntimeActionRunner } from '../dev-runtime-actions.mjs'
import { createRuntimeStateStore } from '../dev-runtime-state.mjs'

function createHarness(overrides = {}) {
  const state = createRuntimeStateStore()
  state.beginGeneration('test')
  const calls = []
  const deferred = {}

  const handlers = {
    generate: () => {
      calls.push('generate')
      return 0
    },
    migrate: () => {
      calls.push('migrate')
      return new Promise((resolve) => { deferred.migrate = resolve })
    },
    restart: () => {
      calls.push('restart')
      return 0
    },
    ...overrides.handlers,
  }

  const runner = createDevRuntimeActionRunner({
    state,
    handlers,
    logger: { error: () => {} },
    ...overrides,
  })

  return { state, runner, calls, deferred }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('rejects an action outside the allowlist without invoking anything', async () => {
  const { runner, calls } = createHarness()
  const result = await runner.run('rm -rf /')
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.equal(result.code, 'unknown_action')
  assert.deepEqual(calls, [])
})

test('queues an allowlisted action and reports the current generation', async () => {
  const { runner, state, calls } = createHarness()
  const result = await runner.run('generate')
  assert.equal(result.ok, true)
  assert.equal(result.generation, state.getGeneration())
  assert.match(result.actionId, /^1-1$/)
  assert.deepEqual(calls, ['generate'])
})

test('marks the runtime as recovering while an action is busy', async () => {
  const { runner, state } = createHarness()
  await runner.run('migrate')
  const status = state.getStatus()
  assert.equal(status.health, 'recovering')
  assert.equal(status.recovery.action, 'migrate')
  assert.equal(status.recovery.busy, true)
})

test('serializes mutating actions to one per generation', async () => {
  const { runner, deferred, calls } = createHarness()
  assert.equal((await runner.run('migrate')).ok, true)

  const rejected = await runner.run('generate')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.status, 409)
  assert.equal(rejected.code, 'action_busy')
  assert.deepEqual(calls, ['migrate'])

  deferred.migrate(0)
  await flush()
  assert.equal((await runner.run('generate')).ok, true)
})

test('records the exit code once the action completes', async () => {
  const { runner, state, deferred } = createHarness()
  await runner.run('migrate')
  deferred.migrate(3)
  await flush()

  const status = state.getStatus()
  assert.equal(status.recovery.busy, false)
  assert.equal(status.recovery.lastExitCode, 3)
})

test('records a failing action as an incident instead of throwing', async () => {
  const { runner, state } = createHarness({
    handlers: { generate: () => { throw new Error('generator crashed') } },
  })

  assert.equal((await runner.run('generate')).ok, true)
  await flush()

  const status = state.getStatus()
  assert.equal(status.recovery.busy, false)
  assert.equal(status.health, 'unavailable')
  assert.equal(status.issueSummary.code, 'recovery_action_failed')
  assert.equal(status.issueSummary.detail, 'The "generate" action did not complete successfully')
})

test('times out a hung action and releases the busy latch', async () => {
  const { runner, state } = createHarness({
    timeoutMs: 10,
    handlers: { generate: () => new Promise(() => {}) },
  })

  assert.equal((await runner.run('generate')).ok, true)
  await new Promise((resolve) => setTimeout(resolve, 40))

  assert.equal(runner.isBusy(), false)
  assert.equal(state.getStatus().issueSummary.code, 'recovery_action_failed')
  assert.equal((await runner.run('generate')).ok, true)
})

test('never lets a stale-generation completion clear a newer recovery', async () => {
  const { runner, state, deferred } = createHarness()
  await runner.run('migrate')

  state.beginGeneration('restart')
  state.beginRecovery('restart')

  deferred.migrate(0)
  await flush()

  assert.equal(state.getStatus().recovery.busy, true)
  assert.equal(state.getStatus().recovery.action, 'restart')
})

test('reports an unsupported action for the current runtime mode', async () => {
  const { runner } = createHarness({ handlers: { restart: undefined } })
  const result = await runner.run('restart')
  assert.equal(result.ok, false)
  assert.equal(result.status, 503)
  assert.equal(result.code, 'action_unsupported')
})

test('reports 503 without a supervisor state', async () => {
  const runner = createDevRuntimeActionRunner({ handlers: { generate: () => 0 } })
  const result = await runner.run('generate')
  assert.equal(result.ok, false)
  assert.equal(result.status, 503)
  assert.equal(result.code, 'supervisor_unavailable')
})

test('describes the active action for the status view', async () => {
  const { runner } = createHarness()
  assert.equal(runner.describeActive(), null)
  await runner.run('migrate')
  assert.deepEqual(Object.keys(runner.describeActive()).sort(), ['action', 'actionId', 'generation', 'startedAt'])
})
