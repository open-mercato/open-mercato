/** @jest-environment node */
// One-off mode starts a full Node process per run, and `delegate_agent` fan-out runs
// NESTED — nested runs deliberately skip the `acquireAgentRunSlot` admission gate to
// avoid livelocking their parent. This semaphore is therefore the only bound on how
// many harness subprocesses a single fan-out can have alive at once.
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { BusinessHarnessExecutionBundle } from '../lib/runtime/businessHarnessContracts'
import { BusinessHarnessProcessClient } from '../lib/runtime/businessHarnessProcessClient'

function bundle(runId: string): BusinessHarnessExecutionBundle {
  return {
    protocolVersion: '1',
    runId,
    agent: {
      id: 'agent.pool',
      version: '1',
      digest: '0123456789abcdef',
      runtimeProfile: 'business-v1',
      instructions: 'Return a result.',
      model: {
        bindingId: 'model-primary',
        bindingRevision: '1',
        driver: 'openai',
        modelId: 'gpt-5-mini',
        credentialBindingId: 'provider-openai',
      },
      capabilities: [],
      loop: { maxSteps: 1, timeoutMs: 120_000, maxToolCalls: 1 },
      output: { mode: 'object', schema: { type: 'object' } },
    },
    input: { prompt: 'test' },
    authorization: { runGrant: 'a-run-grant-token-value' },
  }
}

function resultLine(runId: string): string {
  return `${JSON.stringify({
    kind: 'result',
    result: {
      protocolVersion: '1',
      status: 'completed',
      identity: {
        runId,
        agentId: 'agent.pool',
        agentVersion: '1',
        agentDigest: '0123456789abcdef',
        runtimeProfile: 'business-v1',
        model: { bindingId: 'model-primary', bindingRevision: '1', driver: 'openai', modelId: 'gpt-5-mini' },
        connectors: [],
        toolCatalogDigest: 'd',
      },
      output: {},
      usage: {},
      steps: 1,
      toolCalls: 0,
      durationMs: 1,
    },
  })}\n`
}

/** Spawn stand-in whose children only finish when the test releases them. */
function createSpawnTracker() {
  const live: Array<{ runId: string; finish: () => void }> = []
  let alive = 0
  let peak = 0

  const spawnImplementation = ((_command: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let runId = ''

    child.stdin = {
      once: () => undefined,
      end: (data: string, cb?: () => void) => {
        runId = JSON.parse(data).runId
        alive += 1
        peak = Math.max(peak, alive)
        live.push({
          runId,
          finish: () => {
            stdout.end(resultLine(runId))
            stderr.end()
            alive -= 1
            child.exitCode = 0
            queueMicrotask(() => child.emit('close', 0, null))
          },
        })
        cb?.()
      },
    }
    child.stdout = stdout
    child.stderr = stderr
    child.exitCode = null
    child.signalCode = null
    child.kill = () => true
    return child
  }) as unknown as Parameters<typeof makeClient>[0]

  return { spawnImplementation, live, peak: () => peak }
}

function makeClient(spawnImplementation: unknown) {
  return new BusinessHarnessProcessClient({
    cliPath: '/does/not/matter.js',
    configFile: '/trusted/harness.config.json',
    credentialBrokerUrl: 'http://127.0.0.1:3000/broker',
    spawnImplementation: spawnImplementation as never,
  })
}

const previousCap = process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES

afterEach(() => {
  if (previousCap === undefined) delete process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES
  else process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES = previousCap
})

async function settle() {
  for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('one-off harness subprocess pool', () => {
  it('never keeps more subprocesses alive than the configured cap', async () => {
    process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES = '2'
    const tracker = createSpawnTracker()
    const client = makeClient(tracker.spawnImplementation)

    const runs = ['a', 'b', 'c', 'd', 'e'].map((id) => client.run(bundle(id)))
    await settle()
    expect(tracker.live).toHaveLength(2)

    // Drain the queue one release at a time; the cap must hold the whole way.
    while (tracker.live.length > 0) {
      tracker.live.shift()!.finish()
      await settle()
    }

    const results = await Promise.all(runs)
    expect(results.map((result) => result.identity.runId).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(tracker.peak()).toBeLessThanOrEqual(2)
  })

  it('admits waiters in FIFO order', async () => {
    process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES = '1'
    const tracker = createSpawnTracker()
    const client = makeClient(tracker.spawnImplementation)

    const runs = ['first', 'second', 'third'].map((id) => client.run(bundle(id)))
    const admitted: string[] = []
    await settle()
    while (tracker.live.length > 0) {
      const current = tracker.live.shift()!
      admitted.push(current.runId)
      current.finish()
      await settle()
    }

    await Promise.all(runs)
    expect(admitted).toEqual(['first', 'second', 'third'])
  })

  it('releases the slot when a queued run is aborted rather than leaking it', async () => {
    process.env.OM_BUSINESS_HARNESS_MAX_CONCURRENT_PROCESSES = '1'
    const tracker = createSpawnTracker()
    const client = makeClient(tracker.spawnImplementation)

    const running = client.run(bundle('holder'))
    await settle()

    const controller = new AbortController()
    const queued = client.run(bundle('queued'), { signal: controller.signal })
    await settle()
    expect(tracker.live).toHaveLength(1)

    controller.abort()
    await expect(queued).rejects.toThrow('aborted')

    tracker.live.shift()!.finish()
    await settle()
    await expect(running).resolves.toMatchObject({ identity: { runId: 'holder' } })

    // The aborted waiter must not have consumed the slot it never got.
    const after = client.run(bundle('after'))
    await settle()
    expect(tracker.live).toHaveLength(1)
    tracker.live.shift()!.finish()
    await expect(after).resolves.toMatchObject({ identity: { runId: 'after' } })
  })
})
