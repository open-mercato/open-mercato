import {
  SSE_AUTH_REVALIDATION_INTERVAL_ENV,
  SSE_CONNECTION_MAX_AGE_ENV,
  resolveSseConnectionBounds,
} from '../connectionBounds'

const MAX_TIMER_DELAY_MS = 2_147_483_647

function envWith(revalidation?: string, maxAge?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  if (revalidation !== undefined) env[SSE_AUTH_REVALIDATION_INTERVAL_ENV] = revalidation
  if (maxAge !== undefined) env[SSE_CONNECTION_MAX_AGE_ENV] = maxAge
  return env
}

describe('resolveSseConnectionBounds', () => {
  let randomSpy: jest.SpyInstance<number, []>

  beforeEach(() => {
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    randomSpy.mockRestore()
  })

  it('uses the defaults when the env is unset', () => {
    expect(resolveSseConnectionBounds(envWith())).toEqual({
      authRevalidationIntervalMs: 30_000,
      connectionMaxAgeMs: 300_000,
    })
  })

  it('reads configured positive integer values', () => {
    expect(resolveSseConnectionBounds(envWith('5000', '60000'))).toEqual({
      authRevalidationIntervalMs: 5_000,
      connectionMaxAgeMs: 60_000,
    })
  })

  it.each(['abc', '-1', '0', '999', '1.5', ''])('falls back to the defaults for invalid value %p', (value) => {
    expect(resolveSseConnectionBounds(envWith(value, value))).toEqual({
      authRevalidationIntervalMs: 30_000,
      connectionMaxAgeMs: 300_000,
    })
  })

  it('caps both values at the Node timer maximum', () => {
    randomSpy.mockReturnValue(1)
    const bounds = resolveSseConnectionBounds(envWith('9999999999999', '9999999999999'))
    expect(bounds.authRevalidationIntervalMs).toBe(MAX_TIMER_DELAY_MS)
    expect(bounds.connectionMaxAgeMs).toBe(MAX_TIMER_DELAY_MS)
  })

  it('applies at most 15% jitter to the max age and never drops below 1000ms', () => {
    randomSpy.mockReturnValue(0)
    expect(resolveSseConnectionBounds(envWith(undefined, '100000')).connectionMaxAgeMs).toBe(85_000)
    randomSpy.mockReturnValue(0.999999)
    expect(resolveSseConnectionBounds(envWith(undefined, '100000')).connectionMaxAgeMs).toBe(115_000)
    randomSpy.mockReturnValue(0)
    expect(resolveSseConnectionBounds(envWith(undefined, '1000')).connectionMaxAgeMs).toBe(1_000)
  })

  it('reads process.env by default on every call', () => {
    const previous = process.env[SSE_AUTH_REVALIDATION_INTERVAL_ENV]
    try {
      process.env[SSE_AUTH_REVALIDATION_INTERVAL_ENV] = '2000'
      expect(resolveSseConnectionBounds().authRevalidationIntervalMs).toBe(2_000)
      process.env[SSE_AUTH_REVALIDATION_INTERVAL_ENV] = '3000'
      expect(resolveSseConnectionBounds().authRevalidationIntervalMs).toBe(3_000)
    } finally {
      if (previous === undefined) delete process.env[SSE_AUTH_REVALIDATION_INTERVAL_ENV]
      else process.env[SSE_AUTH_REVALIDATION_INTERVAL_ENV] = previous
    }
  })
})
