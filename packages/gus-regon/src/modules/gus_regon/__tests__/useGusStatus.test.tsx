/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useGusStatus } from '../components/useGusStatus'
import type { GusStatus } from '../lib/status'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

const ORG_DISABLED = 'org-disabled'
const ORG_ENABLED = 'org-enabled'

function statusFor(organizationId: string | null): GusStatus {
  const active = organizationId === ORG_ENABLED
  return {
    enabled: active,
    environment: 'production',
    hasApiKey: active,
    lookupAvailable: active,
    companyFormsRequested: active,
    companyFormsActive: active,
  }
}

function respondWithCurrentScope(currentOrg: () => string | null) {
  mockApiCall.mockImplementation(async () => ({ ok: true, result: statusFor(currentOrg()) }))
}

describe('useGusStatus organization scope', () => {
  let currentOrg: string | null
  let isolation = 0

  function switchTo(organizationId: string) {
    currentOrg = organizationId
    act(() => {
      emitOrganizationScopeChanged({ organizationId, tenantId: 'tenant-1' })
    })
  }

  beforeEach(() => {
    mockApiCall.mockReset()
    isolation += 1
    switchTo(`isolation-${isolation}`)
    respondWithCurrentScope(() => currentOrg)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows the card after switching from a disabled to an enabled organization without remounting', async () => {
    switchTo(ORG_DISABLED)
    const { result } = renderHook(() => useGusStatus())
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(false))

    switchTo(ORG_ENABLED)
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(true))
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('hides the card after switching from an enabled to a disabled organization without remounting', async () => {
    switchTo(ORG_ENABLED)
    const { result } = renderHook(() => useGusStatus())
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(true))

    switchTo(ORG_DISABLED)
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(false))
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('refetches for the new organization after the cache TTL has elapsed', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] })
    switchTo(ORG_DISABLED)
    const { result } = renderHook(() => useGusStatus())
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(false))

    act(() => {
      jest.advanceTimersByTime(31_000)
    })
    switchTo(ORG_ENABLED)
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(true))

    act(() => {
      jest.advanceTimersByTime(31_000)
    })
    switchTo(ORG_DISABLED)
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(false))
    expect(mockApiCall).toHaveBeenCalledTimes(3)
  })

  it('ignores a late response for the previous organization', async () => {
    let resolveStale: (value: unknown) => void = () => undefined
    mockApiCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }),
    )
    switchTo(ORG_ENABLED)
    const { result } = renderHook(() => useGusStatus())

    switchTo(ORG_DISABLED)
    await waitFor(() => expect(result.current?.companyFormsActive).toBe(false))

    await act(async () => {
      resolveStale({ ok: true, result: statusFor(ORG_ENABLED) })
    })
    expect(result.current?.companyFormsActive).toBe(false)
  })

  it('reuses the cached status while the organization stays the same', async () => {
    switchTo(ORG_ENABLED)
    const first = renderHook(() => useGusStatus())
    await waitFor(() => expect(first.result.current?.companyFormsActive).toBe(true))
    first.rerender()

    const second = renderHook(() => useGusStatus())
    await waitFor(() => expect(second.result.current?.companyFormsActive).toBe(true))
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })
})
