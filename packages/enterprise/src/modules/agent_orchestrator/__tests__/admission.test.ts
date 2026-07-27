import {
  acquireAgentRunSlot,
  resetAgentAdmissionForTests,
  isAgentCapacityError,
  AgentCapacityError,
  type AgentRunSlotRelease,
} from '../lib/runtime/admission'

const ADMISSION_ENV_KEYS = [
  'OM_AGENT_MAX_CONCURRENT_RUNS',
  'OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT',
  'OM_AGENT_ADMISSION_MAX_WAIT_MS',
  'OM_AGENT_ADMISSION_MAX_QUEUE',
] as const

function setAdmissionEnv(overrides: Partial<Record<(typeof ADMISSION_ENV_KEYS)[number], string>>): void {
  for (const key of ADMISSION_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value
}

type TrackedPromise<T> = {
  status: 'pending' | 'resolved' | 'rejected'
  value: T | undefined
  error: unknown
}

function track<T>(promise: Promise<T>): TrackedPromise<T> {
  const state: TrackedPromise<T> = { status: 'pending', value: undefined, error: undefined }
  promise.then(
    (value) => {
      state.status = 'resolved'
      state.value = value
    },
    (error) => {
      state.status = 'rejected'
      state.error = error
    },
  )
  return state
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

afterEach(() => {
  resetAgentAdmissionForTests()
  setAdmissionEnv({})
  jest.useRealTimers()
})

describe('agent run admission gate', () => {
  it('admits up to the global cap and queues the next caller', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '2', OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT: '10' })

    const first = await acquireAgentRunSlot('tenant-a')
    const second = await acquireAgentRunSlot('tenant-b')
    const third = track(acquireAgentRunSlot('tenant-c'))
    await flushMicrotasks()
    expect(third.status).toBe('pending')

    first()
    await flushMicrotasks()
    expect(third.status).toBe('resolved')

    second()
    third.value?.()
  })

  it('isolates tenants: tenant B is admitted while tenant A is saturated on its own cap', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '10', OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT: '1' })

    const heldByA = await acquireAgentRunSlot('tenant-a')
    const secondA = track(acquireAgentRunSlot('tenant-a'))
    await flushMicrotasks()
    expect(secondA.status).toBe('pending')

    const heldByB = await acquireAgentRunSlot('tenant-b')
    expect(typeof heldByB).toBe('function')

    heldByA()
    await flushMicrotasks()
    expect(secondA.status).toBe('resolved')

    heldByB()
    secondA.value?.()
  })

  it('admits FIFO among admissible waiters: a tenant-capped waiter does not block later tenants', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '2', OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT: '1' })

    const heldByA = await acquireAgentRunSlot('tenant-a')
    const heldByB = await acquireAgentRunSlot('tenant-b')
    const secondA = track(acquireAgentRunSlot('tenant-a'))
    const firstC = track(acquireAgentRunSlot('tenant-c'))
    await flushMicrotasks()
    expect(secondA.status).toBe('pending')
    expect(firstC.status).toBe('pending')

    // Releasing B frees one global slot. The head waiter (tenant A) is still
    // blocked by A's per-tenant cap, so tenant C behind it must be admitted.
    heldByB()
    await flushMicrotasks()
    expect(secondA.status).toBe('pending')
    expect(firstC.status).toBe('resolved')

    // Releasing the original A slot finally admits the queued A waiter.
    heldByA()
    await flushMicrotasks()
    expect(secondA.status).toBe('resolved')

    secondA.value?.()
    firstC.value?.()
  })

  it('preserves arrival order between admissible waiters of different tenants', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '1', OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT: '5' })

    const held = await acquireAgentRunSlot('tenant-a')
    const firstWaiter = track(acquireAgentRunSlot('tenant-b'))
    const secondWaiter = track(acquireAgentRunSlot('tenant-c'))
    await flushMicrotasks()

    held()
    await flushMicrotasks()
    expect(firstWaiter.status).toBe('resolved')
    expect(secondWaiter.status).toBe('pending')

    firstWaiter.value?.()
    await flushMicrotasks()
    expect(secondWaiter.status).toBe('resolved')
    secondWaiter.value?.()
  })

  it('rejects a waiter with AgentCapacityError when the bounded wait expires', async () => {
    jest.useFakeTimers()
    setAdmissionEnv({
      OM_AGENT_MAX_CONCURRENT_RUNS: '1',
      OM_AGENT_ADMISSION_MAX_WAIT_MS: '5000',
    })

    const held = await acquireAgentRunSlot('tenant-a')
    const waiter = track(acquireAgentRunSlot('tenant-b'))
    await flushMicrotasks()
    expect(waiter.status).toBe('pending')

    jest.advanceTimersByTime(4999)
    await flushMicrotasks()
    expect(waiter.status).toBe('pending')

    jest.advanceTimersByTime(1)
    await flushMicrotasks()
    expect(waiter.status).toBe('rejected')
    expect(isAgentCapacityError(waiter.error)).toBe(true)
    expect((waiter.error as AgentCapacityError).retryable).toBe(true)

    // The expired waiter left the queue: releasing afterwards must not touch it.
    held()
    await flushMicrotasks()
    expect(waiter.status).toBe('rejected')
  })

  it('rejects immediately with AgentCapacityError when the wait queue is full', async () => {
    setAdmissionEnv({
      OM_AGENT_MAX_CONCURRENT_RUNS: '1',
      OM_AGENT_ADMISSION_MAX_QUEUE: '1',
      OM_AGENT_ADMISSION_MAX_WAIT_MS: '60000',
    })
    jest.useFakeTimers()

    const held = await acquireAgentRunSlot('tenant-a')
    const queued = track(acquireAgentRunSlot('tenant-b'))
    await flushMicrotasks()
    expect(queued.status).toBe('pending')

    const overflow = track(acquireAgentRunSlot('tenant-c'))
    await flushMicrotasks()
    expect(overflow.status).toBe('rejected')
    expect(isAgentCapacityError(overflow.error)).toBe(true)

    held()
    await flushMicrotasks()
    expect(queued.status).toBe('resolved')
    queued.value?.()
  })

  it('a released slot is reusable (release-on-throw pattern frees capacity)', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '1' })

    let release: AgentRunSlotRelease | null = null
    await expect(
      (async () => {
        release = await acquireAgentRunSlot('tenant-a')
        try {
          throw new Error('[internal] simulated run failure')
        } finally {
          release?.()
        }
      })(),
    ).rejects.toThrow('simulated run failure')

    const reacquired = await acquireAgentRunSlot('tenant-a')
    expect(typeof reacquired).toBe('function')
    reacquired()
  })

  it('release is idempotent: double-release never frees more than one slot', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '1' })

    const first = await acquireAgentRunSlot('tenant-a')
    first()
    first()

    const second = await acquireAgentRunSlot('tenant-b')
    const third = track(acquireAgentRunSlot('tenant-c'))
    await flushMicrotasks()
    // If the double release had freed two slots, the third acquire would have
    // been admitted immediately alongside the second.
    expect(third.status).toBe('pending')

    second()
    await flushMicrotasks()
    expect(third.status).toBe('resolved')
    third.value?.()
  })

  it('reads the caps lazily on every acquire', async () => {
    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '1' })
    const first = await acquireAgentRunSlot('tenant-a')

    setAdmissionEnv({ OM_AGENT_MAX_CONCURRENT_RUNS: '2' })
    const second = await acquireAgentRunSlot('tenant-a')

    expect(typeof first).toBe('function')
    expect(typeof second).toBe('function')
    first()
    second()
  })
})
