/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { resolveActivityDeleteFeature, useActivityDeleteAccess } from '../useActivityDeleteAccess'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const canonicalRow = { source: 'manual' }
const legacyRow = { source: 'legacy-activity' }

function grant(features: string[]) {
  apiCallMock.mockResolvedValue({ ok: true, result: { granted: features } })
}

describe('useActivityDeleteAccess', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('maps each row to the feature its delete endpoint enforces', () => {
    expect(resolveActivityDeleteFeature(canonicalRow)).toBe('customers.interactions.manage')
    expect(resolveActivityDeleteFeature(legacyRow)).toBe('customers.activities.manage')
  })

  it('asks for both features in one request', async () => {
    grant([])
    renderHook(() => useActivityDeleteAccess())

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const [url, init] = apiCallMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('/api/auth/feature-check')
    expect(JSON.parse(init.body)).toEqual({
      features: ['customers.interactions.manage', 'customers.activities.manage'],
    })
  })

  it('stays closed until the check answers', () => {
    apiCallMock.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useActivityDeleteAccess())

    expect(result.current(canonicalRow)).toBe(false)
    expect(result.current(legacyRow)).toBe(false)
  })

  it('allows only the rows whose feature is granted', async () => {
    grant(['customers.interactions.manage'])
    const { result } = renderHook(() => useActivityDeleteAccess())

    await waitFor(() => expect(result.current(canonicalRow)).toBe(true))
    expect(result.current(legacyRow)).toBe(false)
  })

  it.each([['customers.*'], ['*']])('honors the wildcard grant %s for both kinds of rows', async (wildcard) => {
    grant([wildcard])
    const { result } = renderHook(() => useActivityDeleteAccess())

    await waitFor(() => expect(result.current(canonicalRow)).toBe(true))
    expect(result.current(legacyRow)).toBe(true)
  })

  it('stays closed for a view-only user', async () => {
    grant(['customers.interactions.view', 'customers.activities.view'])
    const { result } = renderHook(() => useActivityDeleteAccess())

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(result.current(canonicalRow)).toBe(false)
    expect(result.current(legacyRow)).toBe(false)
  })

  it.each([
    ['the check is refused', () => apiCallMock.mockResolvedValue({ ok: false, result: null })],
    ['the request fails', () => apiCallMock.mockRejectedValue(new Error('[internal] network down'))],
  ])('stays closed when %s', async (_label, arrange) => {
    arrange()
    const { result } = renderHook(() => useActivityDeleteAccess())

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(result.current(canonicalRow)).toBe(false)
    expect(result.current(legacyRow)).toBe(false)
  })
})
