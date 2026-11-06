let mockNow = 0
const mockDelay = jest.fn()
jest.mock('node:perf_hooks', () => ({ performance: { now: () => mockNow } }))
jest.mock('node:timers/promises', () => ({ setTimeout: (...args: unknown[]) => mockDelay(...args) }))

import { fetchWithApiKeyVerificationRetry } from '../apiKeyVerificationFetch'
import { API_KEY_VERIFICATION_THROTTLE_HEADER } from '../apiKeyVerificationRateLimit'

const originalFetch = global.fetch
const mockFetch = jest.fn()
const url = 'https://app.example.test/api/example/action'
const init = { method: 'POST', headers: { authorization: 'apikey temporary-key' }, body: '{"value":1}' }
const limited = (retryAfter = '1', marker: string | null = '1') => new Response('{"error":"limited"}', {
  status: 429,
  headers: { 'retry-after': retryAfter, ...(marker ? { [API_KEY_VERIFICATION_THROTTLE_HEADER]: marker } : {}) },
})

beforeEach(() => {
  mockNow = 0
  global.fetch = mockFetch
  mockFetch.mockReset()
  mockDelay.mockReset().mockImplementation(async (ms: number, _value: unknown, options: { signal?: AbortSignal }) => {
    options.signal?.throwIfAborted()
    mockNow += ms
  })
})
afterAll(() => { global.fetch = originalFetch })

it('replays the same request only after marked pre-handler rejection, with redirects manual', async () => {
  const first = limited()
  const cancel = jest.spyOn(first.body!, 'cancel')
  const success = new Response('{"ok":true}', { status: 200 })
  mockFetch.mockResolvedValueOnce(first).mockResolvedValueOnce(success)
  await expect(fetchWithApiKeyVerificationRetry(url, { ...init, redirect: 'follow' })).resolves.toBe(success)
  expect(mockFetch.mock.calls).toEqual([
    [url, { ...init, redirect: 'manual' }],
    [url, { ...init, redirect: 'manual' }],
  ])
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(mockDelay).toHaveBeenCalledWith(1000, undefined, { signal: undefined })
})

it('does not replay an unmarked 429 from a business handler', async () => {
  const response = limited('1', null)
  mockFetch.mockResolvedValue(response)
  await expect(fetchWithApiKeyVerificationRetry(url, init)).resolves.toBe(response)
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(mockDelay).not.toHaveBeenCalled()
})

it.each([400, 401, 403, 503])('does not replay status %s even with the reserved marker', async (status) => {
  const response = new Response(null, { status, headers: { [API_KEY_VERIFICATION_THROTTLE_HEADER]: '1', 'retry-after': '1' } })
  mockFetch.mockResolvedValue(response)
  await expect(fetchWithApiKeyVerificationRetry(url, init)).resolves.toBe(response)
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

it.each(['', '0', '-1', '1.5', 'invalid', '999999999999999999999'])('does not wait on invalid or excessive retry guidance %s', async (retryAfter) => {
  const response = limited(retryAfter)
  mockFetch.mockResolvedValue(response)
  await expect(fetchWithApiKeyVerificationRetry(url, init)).resolves.toBe(response)
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(mockDelay).not.toHaveBeenCalled()
})

it('bounds repeated capacity rejection to three retries', async () => {
  mockFetch.mockImplementation(async () => limited())
  const response = await fetchWithApiKeyVerificationRetry(url, init)
  expect(response.status).toBe(429)
  expect(mockFetch).toHaveBeenCalledTimes(4)
  expect(mockDelay).toHaveBeenCalledTimes(3)
})

it('does not add a delay beyond the ten-second retry window', async () => {
  mockFetch.mockImplementation(async () => limited('4'))
  expect((await fetchWithApiKeyVerificationRetry(url, init)).status).toBe(429)
  expect(mockFetch).toHaveBeenCalledTimes(3)
  expect(mockNow).toBe(8000)
})

it('includes request latency in the retry window', async () => {
  const response = limited()
  mockFetch.mockImplementation(async () => { mockNow = 9001; return response })
  await expect(fetchWithApiKeyVerificationRetry(url, init)).resolves.toBe(response)
  expect(mockDelay).not.toHaveBeenCalled()
})

it('does not replay ambiguous network failures', async () => {
  const error = new Error('connection closed after send')
  mockFetch.mockRejectedValue(error)
  await expect(fetchWithApiKeyVerificationRetry(url, init)).rejects.toBe(error)
  expect(mockFetch).toHaveBeenCalledTimes(1)
  expect(mockDelay).not.toHaveBeenCalled()
})

it('aborts before sending a request when its caller has canceled', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(fetchWithApiKeyVerificationRetry(url, { ...init, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockFetch).not.toHaveBeenCalled()
})

it('passes cancellation into backoff and does not send another request after abort', async () => {
  const controller = new AbortController()
  mockFetch.mockResolvedValue(limited())
  mockDelay.mockImplementationOnce(async (_ms: number, _value: unknown, options: { signal: AbortSignal }) => {
    expect(options.signal).toBe(controller.signal)
    controller.abort()
    options.signal.throwIfAborted()
  })
  await expect(fetchWithApiKeyVerificationRetry(url, { ...init, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

it('does not start another request after scheduling stalls beyond the retry window', async () => {
  mockFetch.mockResolvedValue(limited())
  mockDelay.mockImplementationOnce(async () => { mockNow = 10_001 })
  await expect(fetchWithApiKeyVerificationRetry(url, init)).rejects.toMatchObject({ name: 'ApiKeyVerificationRateLimitError' })
  expect(mockFetch).toHaveBeenCalledTimes(1)
})
