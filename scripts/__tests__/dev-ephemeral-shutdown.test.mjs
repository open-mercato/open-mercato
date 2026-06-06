import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { createEphemeralShutdownController } from '../dev-ephemeral-shutdown.mjs'

// Regression guard for issue #2745: the ephemeral PostgreSQL container must be
// removed (awaited) before the process exits, and a SIGINT/SIGTERM that fires
// during initialization — before any dev child exists — must still remove the
// container instead of letting the process die and leak it.

function createDeferred() {
  let resolve = () => {}
  const promise = new Promise((resolveFn) => {
    resolve = resolveFn
  })
  return { promise, resolve }
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('shutdown awaits container removal before exiting (#2745)', async () => {
  const events = []
  const stopGate = createDeferred()
  const controller = createEphemeralShutdownController({
    stopContainer: async (containerId) => {
      events.push(`stop:start:${containerId}`)
      await stopGate.promise
      events.push(`stop:done:${containerId}`)
    },
    exit: (code) => {
      events.push(`exit:${code}`)
    },
  })
  controller.setActiveContainerId('container-abc')

  const shuttingDown = controller.shutdown(7)

  // The container removal is still in flight, so the process must NOT have
  // exited yet. The previous fire-and-forget implementation called
  // process.exit() here, tearing Node down before `docker rm -f` ran.
  assert.deepEqual(events, ['stop:start:container-abc'])

  stopGate.resolve()
  await shuttingDown

  assert.deepEqual(events, ['stop:start:container-abc', 'stop:done:container-abc', 'exit:7'])
})

test('concurrent shutdown calls share one cleanup and exit once (#2745)', async () => {
  const events = []
  const stopGate = createDeferred()
  const controller = createEphemeralShutdownController({
    stopContainer: async (containerId) => {
      events.push(`stop:start:${containerId}`)
      await stopGate.promise
      events.push(`stop:done:${containerId}`)
    },
    exit: (code) => {
      events.push(`exit:${code}`)
    },
  })
  controller.setActiveContainerId('container-abc')

  // A signal-initiated shutdown begins, then main() independently calls shutdown
  // again before cleanup finishes (e.g. the interrupted `initialize` step fails).
  // The second call must await the same in-flight cleanup, not exit early —
  // otherwise its process.exit() pre-empts the still-running `docker rm -f`.
  const first = controller.shutdown(0)
  const second = controller.shutdown(5)

  assert.deepEqual(events, ['stop:start:container-abc'], 'must not exit before cleanup completes')

  stopGate.resolve()
  await Promise.all([first, second])

  assert.deepEqual(events, ['stop:start:container-abc', 'stop:done:container-abc', 'exit:0'])
})

test('a signal during initialization removes the container before exiting (#2745)', async () => {
  const events = []
  const processRef = new EventEmitter()
  const stopGate = createDeferred()
  const controller = createEphemeralShutdownController({
    stopContainer: async (containerId) => {
      events.push(`stop:${containerId}`)
      await stopGate.promise
    },
    exit: (code) => {
      events.push(`exit:${code}`)
    },
    onInterrupt: () => {
      events.push('announce')
    },
    processRef,
  })

  // Handlers installed up front (before the container exists) and only then is
  // the container registered — mirroring the fixed ordering in main().
  controller.installSignalHandlers()
  controller.setActiveContainerId('container-xyz')

  processRef.emit('SIGINT')

  // The handler must begin removing the container; it must not have exited yet.
  assert.deepEqual(events, ['announce', 'stop:container-xyz'])

  stopGate.resolve()
  await flushAsync()

  assert.ok(events.includes('exit:0'), 'process must exit after the container is removed')
  assert.ok(
    events.indexOf('stop:container-xyz') < events.indexOf('exit:0'),
    'the container must be removed before the process exits',
  )
})

test('a signal while the dev runtime is running forwards the signal for a graceful shutdown', () => {
  const events = []
  const processRef = new EventEmitter()
  const devChild = {
    killed: false,
    kill: (signal) => events.push(`kill:${signal}`),
  }
  const controller = createEphemeralShutdownController({
    stopContainer: async () => {
      events.push('stop')
    },
    exit: (code) => {
      events.push(`exit:${code}`)
    },
    onInterrupt: () => {
      events.push('announce')
    },
    processRef,
  })
  controller.installSignalHandlers()
  controller.setActiveContainerId('container-1')
  controller.setActiveChild(devChild)

  processRef.emit('SIGTERM')

  // With a live dev child the signal is forwarded so the runtime can shut down
  // gracefully; its own exit handler removes the container afterwards. The
  // controller must not force-stop or exit directly here.
  assert.deepEqual(events, ['announce', 'kill:SIGTERM'])
})

test('installSignalHandlers is idempotent', () => {
  const processRef = new EventEmitter()
  const controller = createEphemeralShutdownController({
    stopContainer: async () => {},
    exit: () => {},
    processRef,
  })

  controller.installSignalHandlers()
  controller.installSignalHandlers()

  assert.equal(processRef.listenerCount('SIGINT'), 1)
  assert.equal(processRef.listenerCount('SIGTERM'), 1)
})

test('shutdown exits even when no container was started', async () => {
  const events = []
  const controller = createEphemeralShutdownController({
    stopContainer: async () => {
      events.push('stop')
    },
    exit: (code) => {
      events.push(`exit:${code}`)
    },
  })

  await controller.shutdown(3)

  assert.deepEqual(events, ['exit:3'])
})

test('requires a stopContainer function', () => {
  assert.throws(() => createEphemeralShutdownController({}), TypeError)
})
