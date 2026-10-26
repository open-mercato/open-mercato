/** @jest-environment node */
import {
  OAUTH_GRANT_TEST_ROUTE_PATH,
  connectTestGrant,
  corruptTestGrant,
  isOAuthGrantTestRouteAvailable,
  refreshTestGrant,
  resetTestGrants,
} from '../oauthGrantTestRoute'

type FetchCall = { path: string; options: { method: string; data?: unknown; headers?: Record<string, string> } }

function fakeRequest(calls: FetchCall[], status: number, body: unknown) {
  return {
    fetch: async (path: string, options: FetchCall['options']) => {
      calls.push({ path, options })
      return {
        ok: () => status >= 200 && status < 300,
        status: () => status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
      }
    },
  } as never
}

describe('oauthGrantTestRoute', () => {
  const originalFlag = process.env.OM_ENABLE_TEST_OAUTH_GRANTS

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = originalFlag
  })

  it('reports the route as available when the probe is answered with anything but 404', async () => {
    const calls: FetchCall[] = []

    await expect(isOAuthGrantTestRouteAvailable(fakeRequest(calls, 400, { error: 'Invalid request body' }), 'token')).resolves.toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe(OAUTH_GRANT_TEST_ROUTE_PATH)
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].options.headers?.Authorization).toBe('Bearer token')
    expect(calls[0].options.data).toEqual({ action: '__probe__', integrationId: 'test_oauth_grant' })
  })

  it('reports the route as unavailable on 404 when this process runs without the flag', async () => {
    delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS

    await expect(isOAuthGrantTestRouteAvailable(fakeRequest([], 404, { error: 'Not found' }), 'token')).resolves.toBe(false)
  })

  it('throws on 404 when this process runs with the flag, so a broken route never becomes a skip', async () => {
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'

    await expect(isOAuthGrantTestRouteAvailable(fakeRequest([], 404, { error: 'Not found' }), 'token')).rejects.toThrow(
      /answered 404 although OM_ENABLE_TEST_OAUTH_GRANTS is on/,
    )
  })

  it('posts each action for test_oauth_grant and returns the parsed body', async () => {
    const calls: FetchCall[] = []

    await expect(
      connectTestGrant(fakeRequest(calls, 200, { reconnect: false, revisedAt: '2026-10-01T00:00:00.000Z' }), 'token', { scopes: ['read'] }),
    ).resolves.toEqual({ reconnect: false, revisedAt: '2026-10-01T00:00:00.000Z' })
    await expect(
      refreshTestGrant(fakeRequest(calls, 200, { result: 'grant_invalidated', degraded: false }), 'token', { outcome: 'invalid_grant' }),
    ).resolves.toEqual({ result: 'grant_invalidated', degraded: false })
    await expect(corruptTestGrant(fakeRequest(calls, 200, { corrupted: true }), 'token')).resolves.toBe(true)
    await expect(resetTestGrants(fakeRequest(calls, 200, { ok: true }), 'token')).resolves.toBeUndefined()

    expect(calls.map((call) => call.options.data)).toEqual([
      { action: 'connect', scopes: ['read'], integrationId: 'test_oauth_grant' },
      { action: 'refresh', outcome: 'invalid_grant', integrationId: 'test_oauth_grant' },
      { action: 'corruptGrant', integrationId: 'test_oauth_grant' },
      { action: 'reset', integrationId: 'test_oauth_grant' },
    ])
    expect(calls.every((call) => call.path === OAUTH_GRANT_TEST_ROUTE_PATH && call.options.method === 'POST')).toBe(true)
  })

  it('throws with the status when the route does not answer 200', async () => {
    await expect(connectTestGrant(fakeRequest([], 501, { error: 'Not implemented' }), 'token')).rejects.toThrow(
      /\(connect\) answered 501/,
    )
  })

  it('throws when the body does not match the action', async () => {
    await expect(refreshTestGrant(fakeRequest([], 200, { result: 'mystery', degraded: false }), 'token')).rejects.toThrow(
      /\(refresh\) returned an unexpected body/,
    )
  })
})
