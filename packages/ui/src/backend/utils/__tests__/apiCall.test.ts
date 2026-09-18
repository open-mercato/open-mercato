jest.mock('../../utils/api', () => ({
  apiFetch: jest.fn(),
}))
jest.mock('../../utils/serverErrors', () => {
  const actual = jest.requireActual('../../utils/serverErrors')
  return {
    ...actual,
    raiseCrudError: jest.fn(),
  }
})

import { apiFetch } from '../../utils/api'
import { raiseCrudError } from '../../utils/serverErrors'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '../../utils/apiCall'

function createMockResponse(body: string, init?: { status?: number }): Response {
  const status = init?.status ?? 200
  const ok = status >= 200 && status < 300
  const responseBody = body
  return {
    ok,
    status,
    headers: new Map<string, string>(),
    text: jest.fn(async () => responseBody),
    clone: () => createMockResponse(responseBody, { status }),
  } as unknown as Response
}

describe('apiCall', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns parsed JSON result by default', async () => {
    const payload = { ok: true }
    const response = createMockResponse(JSON.stringify(payload), { status: 200 })
    ;(apiFetch as jest.Mock).mockResolvedValue(response)
    const result = await apiCall<{ ok: boolean }>('/api/test')
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.result).toEqual(payload)
    expect(result.response).toBe(response)
  })

  it('uses fallback when parsing fails', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(new Response('not json', { status: 200 }))
    const result = await apiCall<{ ok: boolean }>('/api/test', undefined, { fallback: { ok: false } })
    expect(result.result).toEqual({ ok: false })
  })

  it('supports custom parser', async () => {
    const response = new Response('data', { status: 202 })
    ;(apiFetch as jest.Mock).mockResolvedValue(response)
    const parser = jest.fn(async () => ({ parsed: true }))
    const result = await apiCall<{ parsed: boolean }>('/api/custom', undefined, { parse: parser })
    expect(parser).toHaveBeenCalled()
    expect(result.result).toEqual({ parsed: true })
  })
})

describe('apiCallOrThrow', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns call result when successful', async () => {
    const payload = { ok: true }
    const response = createMockResponse(JSON.stringify(payload), { status: 200 })
    ;(apiFetch as jest.Mock).mockResolvedValue(response)
    const call = await apiCallOrThrow<{ ok: boolean }>('/api/success', undefined, { errorMessage: 'failed' })
    expect(call.ok).toBe(true)
    expect(call.result).toEqual(payload)
    expect(raiseCrudError).not.toHaveBeenCalled()
  })

  it('delegates to raiseCrudError when response is not ok', async () => {
    const response = createMockResponse(JSON.stringify({ error: 'nope' }), { status: 500 })
    ;(apiFetch as jest.Mock).mockResolvedValue(response)
    ;(raiseCrudError as jest.Mock).mockRejectedValue(new Error('nope'))
    await expect(apiCallOrThrow('/api/fail', undefined, { errorMessage: 'failed' })).rejects.toThrow('nope')
    expect(raiseCrudError).toHaveBeenCalledWith(response, 'failed')
  })
})

describe('readApiResultOrThrow', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns parsed result when present', async () => {
    const payload = { ok: true }
    ;(apiFetch as jest.Mock).mockResolvedValue(createMockResponse(JSON.stringify(payload), { status: 200 }))
    const result = await readApiResultOrThrow<{ ok: boolean }>('/api/result')
    expect(result).toEqual(payload)
  })

  it('throws when result is null and not allowed', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(createMockResponse('', { status: 200 }))
    await expect(
      readApiResultOrThrow('/api/empty', undefined, { errorMessage: 'failed', emptyResultMessage: 'missing' }),
    ).rejects.toThrow('missing')
  })

  it('allows null result when configured', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(createMockResponse('', { status: 200 }))
    const result = await readApiResultOrThrow('/api/empty-ok', undefined, { allowNullResult: true })
    expect(result).toBeNull()
  })
})

describe('aborted requests', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  function createAbortedBodyResponse(): Response {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    const response = {
      ok: true,
      status: 200,
      headers: new Map<string, string>(),
      text: jest.fn(async () => { throw abortError }),
      clone: () => response,
    } as unknown as Response
    return response
  }

  it('rejects with AbortError instead of reporting an empty payload', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(createAbortedBodyResponse())
    const controller = new AbortController()
    controller.abort()

    await expect(
      readApiResultOrThrow('/api/interactions', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not mask a genuinely empty payload when the request was not aborted', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(createMockResponse('', { status: 200 }))
    const controller = new AbortController()

    await expect(
      readApiResultOrThrow('/api/interactions', { signal: controller.signal }),
    ).rejects.toThrow('Missing response payload (200)')
  })

  it('keeps the caller-provided fallback when one is configured', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(createAbortedBodyResponse())
    const controller = new AbortController()
    controller.abort()

    const call = await apiCall<{ items: string[] }>(
      '/api/interactions',
      { signal: controller.signal },
      { fallback: { items: [] } },
    )
    expect(call.result).toEqual({ items: [] })
  })

  it('propagates AbortError raised by a custom parser', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(createMockResponse('{}', { status: 200 }))
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'

    await expect(
      apiCall('/api/interactions', undefined, { parse: async () => { throw abortError } }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
