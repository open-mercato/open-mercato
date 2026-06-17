import { FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { decodeBase64Url, encodeBase64Url, getGmailApiClient, GmailApiError, setGmailApiClient } from '../gmail-client'

describe('base64url encoding helpers', () => {
  it('encodeBase64Url uses URL-safe alphabet without padding', () => {
    const buffer = Buffer.from('Hello, world?', 'utf-8')
    const encoded = encodeBase64Url(buffer)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
    expect(decodeBase64Url(encoded).toString('utf-8')).toBe('Hello, world?')
  })

  it('decodeBase64Url tolerates padded inputs', () => {
    const buffer = Buffer.from('1', 'utf-8')
    const encoded = buffer.toString('base64') // produces '1' → 'MQ=='
    expect(decodeBase64Url(encoded).toString('utf-8')).toBe('1')
  })

  it('round-trips arbitrary binary data', () => {
    const input = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(decodeBase64Url(encodeBase64Url(input))).toEqual(input)
  })
})

describe('GmailApiError', () => {
  it('captures status + detail for downstream classification', () => {
    const e = new GmailApiError('Gmail API GET /history failed: invalid_grant', 401, 'invalid_grant')
    expect(e.name).toBe('GmailApiError')
    expect(e.status).toBe(401)
    expect(e.detail).toBe('invalid_grant')
  })
})

type FakeResponseInit = {
  ok?: boolean
  status: number
  statusText?: string
  body?: string
  headers?: Record<string, string>
}

function fakeResponse(init: FakeResponseInit): Response {
  const headerMap = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return {
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    statusText: init.statusText ?? '',
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    text: async () => init.body ?? '',
  } as unknown as Response
}

describe('FetchGmailApiClient.requestJson retry/backoff', () => {
  // Mirrors GMAIL_DEFAULT_REQUEST_TIMEOUT_MS in gmail-client.ts: the per-request
  // timeout `fetchWithTimeout` schedules when no OM_CHANNEL_GMAIL_REQUEST_TIMEOUT_MS
  // override is set (none of these tests set it).
  const GMAIL_DEFAULT_REQUEST_TIMEOUT_MS = 30_000
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const originalRandom = Math.random
  let capturedDelays: number[]

  beforeEach(() => {
    // Reset the cached singleton so each test gets the real FetchGmailApiClient
    // (other suites may have swapped in a mock via setGmailApiClient).
    setGmailApiClient(null)
    capturedDelays = []
    // Replace the backoff sleep with a synchronous no-wait shim that records the
    // requested delay and fires the callback immediately, so the retry loop runs
    // without real timers while we assert the computed wait durations. The
    // shared `fetchWithTimeout` helper also schedules a per-request timeout timer
    // (`GMAIL_DEFAULT_REQUEST_TIMEOUT_MS`); delegate that one to the real timer —
    // the helper clears it in its `finally` before the mocked fetch resolves, so
    // it never fires and never pollutes the recorded backoff delays.
    globalThis.setTimeout = ((callback: () => void, ms?: number) => {
      if (ms === GMAIL_DEFAULT_REQUEST_TIMEOUT_MS) {
        return originalSetTimeout(callback, ms)
      }
      capturedDelays.push(typeof ms === 'number' ? ms : 0)
      callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof globalThis.setTimeout
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    Math.random = originalRandom
    setGmailApiClient(null)
  })

  it('retries a 429 then succeeds on the following 200', async () => {
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      if (calls === 1) {
        return Promise.resolve(
          fakeResponse({ status: 429, statusText: 'Too Many Requests', body: '', headers: { 'retry-after': '2' } }),
        )
      }
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '7' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const profile = await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(calls).toBe(2)
    expect(profile.historyId).toBe('7')
    // Numeric Retry-After: `2` seconds → 2000ms, bounded by the 8s cap.
    expect(capturedDelays).toEqual([2000])
  })

  it('retries a transient 503 then succeeds, honoring computeBackoff when no Retry-After header', async () => {
    Math.random = () => 0 // strip jitter so the backoff is deterministic
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      if (calls <= 2) {
        return Promise.resolve(fakeResponse({ status: 503, statusText: 'Service Unavailable', body: '' }))
      }
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '9' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const profile = await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(calls).toBe(3)
    expect(profile.historyId).toBe('9')
    // computeBackoff(attempt) = 500 * 2^attempt (+0 jitter): attempt 0 → 500ms, attempt 1 → 1000ms.
    expect(capturedDelays).toEqual([500, 1000])
  })

  it('caps computeBackoff growth at the 8s ceiling across successive attempts', async () => {
    Math.random = () => 0
    // Always-5xx so the client exhausts all retries; this walks attempts 0..2 of
    // computeBackoff (the 4th call has no further retry). 500, 1000, 2000 — all
    // below the cap, but the doubling growth + ceiling math is exercised; assert
    // each step is min(500 * 2^attempt, 8000) and monotonically non-decreasing.
    globalThis.fetch = (() =>
      Promise.resolve(fakeResponse({ status: 500, statusText: 'Server Error', body: '' }))) as unknown as typeof globalThis.fetch

    await expect(getGmailApiClient().getProfile({ accessToken: 'token' })).rejects.toBeInstanceOf(GmailApiError)

    expect(capturedDelays).toEqual([500, 1000, 2000])
    for (const delay of capturedDelays) expect(delay).toBeLessThanOrEqual(8000)
    for (let i = 1; i < capturedDelays.length; i += 1) {
      expect(capturedDelays[i]).toBeGreaterThanOrEqual(capturedDelays[i - 1])
    }
  })

  it('honors an HTTP-date Retry-After value, bounded by the 8s cap', async () => {
    let calls = 0
    // 3 seconds in the future → ~3000ms wait, still under the 8s ceiling.
    const retryAt = new Date(Date.now() + 3_000).toUTCString()
    globalThis.fetch = (() => {
      calls += 1
      if (calls === 1) {
        return Promise.resolve(
          fakeResponse({ status: 429, statusText: 'Too Many Requests', body: '', headers: { 'retry-after': retryAt } }),
        )
      }
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '1' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(calls).toBe(2)
    expect(capturedDelays).toHaveLength(1)
    // Date.parse(retryAt) drops sub-second precision, so the delta is ~2000-3000ms.
    expect(capturedDelays[0]).toBeGreaterThan(1000)
    expect(capturedDelays[0]).toBeLessThanOrEqual(8000)
  })

  it('throws GmailApiError carrying the upstream status after exhausting retries', async () => {
    Math.random = () => 0
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      return Promise.resolve(
        fakeResponse({ status: 503, statusText: 'Service Unavailable', body: JSON.stringify({ error: { message: 'backend overloaded' } }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const thrown = await getGmailApiClient()
      .getProfile({ accessToken: 'token' })
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(GmailApiError)
    expect((thrown as GmailApiError).status).toBe(503)
    expect((thrown as GmailApiError).detail).toBe('backend overloaded')
    // GMAIL_MAX_RETRIES = 3 → 1 initial + 3 retries = 4 total attempts.
    expect(calls).toBe(4)
    expect(capturedDelays).toEqual([500, 1000, 2000])
  })

  it('does not retry a permanent 401 — fails fast with no backoff', async () => {
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      return Promise.resolve(
        fakeResponse({ status: 401, statusText: 'Unauthorized', body: JSON.stringify({ error: { message: 'invalid_grant' } }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const thrown = await getGmailApiClient()
      .getProfile({ accessToken: 'token' })
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(GmailApiError)
    expect((thrown as GmailApiError).status).toBe(401)
    expect(calls).toBe(1)
    expect(capturedDelays).toEqual([])
  })

  it('attaches an AbortSignal to each request so a stalled connection cannot hang the worker (issue #2976)', async () => {
    let capturedSignal: unknown
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '1' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })

  it('treats a timed-out (TimeoutError) fetch as transient and retries it (issue #2976)', async () => {
    Math.random = () => 0
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      if (calls === 1) {
        // `AbortSignal.timeout()` rejects fetch with a `TimeoutError` DOMException,
        // not an `AbortError` — exercise the real production failure shape.
        return Promise.reject(new DOMException('The operation timed out', 'TimeoutError'))
      }
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '5' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const profile = await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(calls).toBe(2)
    expect(profile.historyId).toBe('5')
    // computeBackoff(0) = 500ms (jitter stripped) — the timeout took the retry path.
    expect(capturedDelays).toEqual([500])
  })

  it('treats a shared-helper FetchTimeoutError as transient and retries it (issue #3068)', async () => {
    Math.random = () => 0
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      if (calls === 1) {
        // After consolidating onto `fetchWithTimeout`, an elapsed per-request
        // timeout surfaces as `FetchTimeoutError` (a real Error subclass), not a
        // `TimeoutError` DOMException — exercise that production failure shape.
        return Promise.reject(new FetchTimeoutError('https://gmail.googleapis.com/gmail/v1/users/me/profile', 30_000))
      }
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '11' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const profile = await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(calls).toBe(2)
    expect(profile.historyId).toBe('11')
    expect(capturedDelays).toEqual([500])
  })

  it('also retries an externally-aborted (AbortError) fetch (issue #2976)', async () => {
    Math.random = () => 0
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      if (calls === 1) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
      return Promise.resolve(
        fakeResponse({ status: 200, statusText: 'OK', body: JSON.stringify({ emailAddress: 'a@gmail.com', historyId: '7' }) }),
      )
    }) as unknown as typeof globalThis.fetch

    const profile = await getGmailApiClient().getProfile({ accessToken: 'token' })

    expect(calls).toBe(2)
    expect(profile.historyId).toBe('7')
    expect(capturedDelays).toEqual([500])
  })

  it('throws a GmailApiError after timeouts exhaust the retry budget (issue #2976)', async () => {
    Math.random = () => 0
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      return Promise.reject(new DOMException('The operation timed out', 'TimeoutError'))
    }) as unknown as typeof globalThis.fetch

    const thrown = await getGmailApiClient()
      .getProfile({ accessToken: 'token' })
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(GmailApiError)
    expect((thrown as GmailApiError).status).toBe(599)
    // 1 initial + 3 retries = 4 attempts; backoff fired on the first 3.
    expect(calls).toBe(4)
    expect(capturedDelays).toEqual([500, 1000, 2000])
  })
})
