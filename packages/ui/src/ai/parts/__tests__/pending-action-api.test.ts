/**
 * @jest-environment jsdom
 */

import { confirmPendingAction, cancelPendingAction } from '../pending-action-api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('pending-action-api', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns the 403 tool_features_denied envelope from confirm instead of a network error', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(403, {
        error: "Caller lacks one of the tool's required features: catalog.products.manage",
        code: 'tool_features_denied',
      }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await confirmPendingAction('pa-1')

    expect(result).toEqual({
      ok: false,
      error: {
        status: 403,
        code: 'tool_features_denied',
        message: "Caller lacks one of the tool's required features: catalog.products.manage",
        extra: undefined,
      },
    })
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit]
    expect(new Headers(init.headers).get('x-om-forbidden-redirect')).toBe('0')
  })

  it('keeps the JSON content type and the forbidden opt-out when cancel sends a body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(403, { error: 'Forbidden', code: 'forbidden' }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await cancelPendingAction('pa-1', { reason: 'not needed' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('x-om-forbidden-redirect')).toBe('0')
    expect(headers.get('content-type')).toBe('application/json')
  })
})
