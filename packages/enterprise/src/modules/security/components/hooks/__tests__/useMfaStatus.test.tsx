/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useMfaStatus } from '../useMfaStatus'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

const mockApiCall = jest.mocked(apiCall)
const method = { id: 'method-id', type: 'totp', label: null, providerMetadata: null, lastUsedAt: null, createdAt: '2026-11-16T00:00:00Z' }
const provider = { type: 'totp', label: 'Authenticator app', icon: 'Shield', allowMultiple: false }

function mockLookup(failingPath?: string, transportFailure = false) {
  mockApiCall.mockImplementation(async (path) => {
    if (path === failingPath && transportFailure) throw new Error('[internal] Transport unavailable')
    const ok = path !== failingPath
    return {
      ok,
      status: ok ? 200 : 503,
      response: {} as Response,
      result: ok ? path.endsWith('/methods') ? { methods: [method] } : { providers: [provider] } : undefined,
    }
  })
}

beforeEach(() => jest.clearAllMocks())

describe('useMfaStatus lookup failures', () => {
  test.each(['/api/security/mfa/providers', '/api/security/mfa/methods'])('exposes an HTTP failure from %s and recovers on retry', async (failingPath) => {
    mockLookup(failingPath)
    const { result } = renderHook(() => useMfaStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBe(true)

    mockLookup()
    await act(async () => result.current.reload())
    expect(result.current.loadError).toBe(false)
    expect(result.current.providers).toEqual([provider])
    expect(result.current.methods).toEqual([method])
  })

  test('preserves the last successful methods and providers when a reload fails', async () => {
    mockLookup()
    const { result } = renderHook(() => useMfaStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockLookup('/api/security/mfa/providers')
    await act(async () => result.current.reload())
    expect(result.current.loadError).toBe(true)
    expect(result.current.providers).toEqual([provider])
    expect(result.current.methods).toEqual([method])
  })

  test('handles a rejected transport promise without leaving loading active', async () => {
    mockLookup('/api/security/mfa/providers', true)
    const { result } = renderHook(() => useMfaStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBe(true)
  })

  test('accepts successful empty arrays as a loaded empty state', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, response: {} as Response, result: { methods: [], providers: [] } })
    const { result } = renderHook(() => useMfaStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBe(false)
    expect(result.current.methods).toEqual([])
    expect(result.current.providers).toEqual([])
  })

  test('rejects a malformed successful lookup instead of treating it as empty', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, response: {} as Response, result: {} })
    const { result } = renderHook(() => useMfaStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBe(true)
  })
})
