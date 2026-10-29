import {
  runWithProviderBudget,
  resetProviderBudgetForTests,
  isRetryableProviderError,
  AgentProviderCapacityError,
} from '../lib/runtime/providerBudget'
import { isAgentCapacityError } from '../lib/runtime/admission'

const BUDGET_ENV_KEYS = [
  'OM_AGENT_PROVIDER_MAX_CONCURRENT',
  'OM_AGENT_PROVIDER_MAX_CONCURRENT_PROV_A',
  'OM_AGENT_PROVIDER_RETRY_MAX',
  'OM_AGENT_PROVIDER_RETRY_BASE_MS',
] as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function farDeadline(): number {
  return Date.now() + 60_000
}

function throttlingError(status: number): Error {
  const err = new Error(`provider throttled (${status})`) as Error & { statusCode: number }
  err.statusCode = status
  return err
}

beforeEach(() => {
  for (const key of BUDGET_ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  resetProviderBudgetForTests()
  for (const key of BUDGET_ENV_KEYS) delete process.env[key]
  jest.restoreAllMocks()
})

describe('per-provider concurrency cap', () => {
  it('caps concurrent calls per provider while other providers proceed', async () => {
    process.env.OM_AGENT_PROVIDER_MAX_CONCURRENT = '1'

    let releaseFirst: (() => void) | null = null
    const firstStarted = new Promise<void>((markStarted) => {
      void runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, () => {
        markStarted()
        return new Promise<string>((resolve) => {
          releaseFirst = () => resolve('first')
        })
      })
    })
    await firstStarted

    let secondStarted = false
    const second = runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, async () => {
      secondStarted = true
      return 'second'
    })

    // Another provider is not blocked by prov-a's saturated budget.
    const otherProvider = await runWithProviderBudget(
      { providerId: 'prov-b', deadlineAtMs: farDeadline() },
      async () => 'other',
    )
    expect(otherProvider).toBe('other')

    await delay(20)
    expect(secondStarted).toBe(false)

    releaseFirst!()
    await expect(second).resolves.toBe('second')
    expect(secondStarted).toBe(true)
  })

  it('honors the per-provider override env var', async () => {
    process.env.OM_AGENT_PROVIDER_MAX_CONCURRENT = '1'
    process.env.OM_AGENT_PROVIDER_MAX_CONCURRENT_PROV_A = '2'

    let releases = 0
    const hold = () =>
      runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, async () => {
        releases += 1
        await delay(30)
        return releases
      })
    const [a, b] = [hold(), hold()]
    await delay(10)
    // Both admitted concurrently under the raised per-provider cap.
    expect(releases).toBe(2)
    await Promise.all([a, b])
  })

  it('rejects with a retryable capacity error when the deadline expires while queued', async () => {
    process.env.OM_AGENT_PROVIDER_MAX_CONCURRENT = '1'

    let releaseFirst: (() => void) | null = null
    void runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, () => {
      return new Promise<void>((resolve) => {
        releaseFirst = () => resolve()
      })
    })
    for (let i = 0; i < 50 && releaseFirst === null; i += 1) await delay(1)

    const queued = runWithProviderBudget(
      { providerId: 'prov-a', deadlineAtMs: Date.now() + 25 },
      async () => 'never',
    )
    await expect(queued).rejects.toBeInstanceOf(AgentProviderCapacityError)
    await queued.catch((err: unknown) => {
      expect(isAgentCapacityError(err)).toBe(true)
      expect((err as { retryable?: boolean }).retryable).toBe(true)
    })
    releaseFirst!()
  })
})

describe('retry on 429/overloaded with backoff', () => {
  it('retries a 429 and succeeds', async () => {
    process.env.OM_AGENT_PROVIDER_RETRY_BASE_MS = '1'
    let attempts = 0
    const result = await runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, async () => {
      attempts += 1
      if (attempts < 3) throw throttlingError(429)
      return 'recovered'
    })
    expect(result).toBe('recovered')
    expect(attempts).toBe(3)
  })

  it('exhausts OM_AGENT_PROVIDER_RETRY_MAX and surfaces a retryable capacity error', async () => {
    process.env.OM_AGENT_PROVIDER_RETRY_BASE_MS = '1'
    process.env.OM_AGENT_PROVIDER_RETRY_MAX = '2'
    let attempts = 0
    const exhausted = runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, async () => {
      attempts += 1
      throw throttlingError(429)
    })
    await expect(exhausted).rejects.toBeInstanceOf(AgentProviderCapacityError)
    expect(attempts).toBe(3) // initial call + 2 retries
  })

  it('never sleeps past the run deadline — surfaces capacity instead', async () => {
    process.env.OM_AGENT_PROVIDER_RETRY_BASE_MS = '10000'
    jest.spyOn(Math, 'random').mockReturnValue(0.5) // deterministic 5000ms backoff
    let attempts = 0
    const bounded = runWithProviderBudget(
      { providerId: 'prov-a', deadlineAtMs: Date.now() + 50 },
      async () => {
        attempts += 1
        throw throttlingError(429)
      },
    )
    await expect(bounded).rejects.toBeInstanceOf(AgentProviderCapacityError)
    expect(attempts).toBe(1)
  })

  it('rethrows non-throttling errors immediately without retrying', async () => {
    let attempts = 0
    const failed = runWithProviderBudget({ providerId: 'prov-a', deadlineAtMs: farDeadline() }, async () => {
      attempts += 1
      throw new Error('[internal] schema exploded')
    })
    await expect(failed).rejects.toThrow('schema exploded')
    expect(attempts).toBe(1)
  })
})

describe('isRetryableProviderError', () => {
  it.each([
    [throttlingError(429), true],
    [throttlingError(529), true],
    [throttlingError(503), true],
    [Object.assign(new Error('x'), { data: { error: { type: 'overloaded_error' } } }), true],
    [new Error('Rate limit exceeded, retry later'), true],
    [new Error('[internal] validation failed'), false],
    [throttlingError(500), false],
    [null, false],
  ])('classifies %p as %p', (err, expected) => {
    expect(isRetryableProviderError(err)).toBe(expected)
  })
})
