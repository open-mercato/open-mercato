/**
 * @jest-environment jsdom
 */
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  REQUEST_TIMEOUT_MS,
  isAbortError,
  readApiResultWithTimeout,
} from '../readApiResultWithTimeout'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function hangUntilAborted(): void {
  readApiResultOrThrowMock.mockImplementation(
    (_input: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(abortError()))
      }),
  )
}

describe('readApiResultWithTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    readApiResultOrThrowMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('uses a 12 second timeout by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(12_000)
  })

  it('resolves with the read value', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [1, 2] })

    await expect(
      readApiResultWithTimeout('/api/example', undefined, { errorMessage: 'Timed out' }),
    ).resolves.toEqual({ items: [1, 2] })
  })

  it('aborts after the timeout and rejects with the caller-provided message', async () => {
    hangUntilAborted()

    const result = readApiResultWithTimeout('/api/example', undefined, { errorMessage: 'Timed out' })
    const assertion = expect(result).rejects.toThrow('Timed out')

    const init = readApiResultOrThrowMock.mock.calls[0][1] as RequestInit
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1)
    expect(init.signal?.aborted).toBe(false)

    jest.advanceTimersByTime(1)
    expect(init.signal?.aborted).toBe(true)
    await assertion
  })

  it('honours a custom timeout', async () => {
    hangUntilAborted()

    const result = readApiResultWithTimeout('/api/example', undefined, { errorMessage: 'Too slow' }, 500)
    const assertion = expect(result).rejects.toThrow('Too slow')
    jest.advanceTimersByTime(500)
    await assertion
  })

  it('rethrows a non-abort error unchanged', async () => {
    const failure = new Error('HTTP 500')
    readApiResultOrThrowMock.mockRejectedValue(failure)

    await expect(
      readApiResultWithTimeout('/api/example', undefined, { errorMessage: 'Timed out' }),
    ).rejects.toBe(failure)
  })

  it('merges an AbortSignal into the caller init and forwards the options', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ granted: [] })
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"features":[]}',
    }
    const options = { errorMessage: 'Timed out', fallback: { granted: [] } }

    await readApiResultWithTimeout('/api/auth/feature-check', init, options)

    expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
      '/api/auth/feature-check',
      { ...init, signal: expect.any(AbortSignal) },
      options,
    )
  })

  it('clears its timer once the read settles, whether it resolved or failed', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({ ok: true })
    await readApiResultWithTimeout('/api/example', undefined, { errorMessage: 'Timed out' })
    expect(jest.getTimerCount()).toBe(0)

    readApiResultOrThrowMock.mockRejectedValueOnce(new Error('HTTP 500'))
    await expect(
      readApiResultWithTimeout('/api/example', undefined, { errorMessage: 'Timed out' }),
    ).rejects.toThrow('HTTP 500')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('recognises only errors named AbortError as aborts', () => {
    expect(isAbortError(abortError())).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
