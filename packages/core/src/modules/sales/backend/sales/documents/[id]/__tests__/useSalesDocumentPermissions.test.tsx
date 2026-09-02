/**
 * @jest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useSalesDocumentPermissions } from '../useSalesDocumentPermissions'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const ALL_FEATURES = [
  'sales.documents.number.edit',
  'sales.orders.manage',
  'sales.quotes.manage',
  'sales.payments.manage',
  'sales.shipments.manage',
  'sales.returns.create',
  'sales.returns.manage',
]

function grantedResponse(granted: string[]) {
  return { ok: true, status: 200, result: { granted } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Each emit must use a fresh organization id: the scope event module tracks the last emitted
// scope globally and only bumps its version on an actual change.
let scopeCounter = 0
function switchScope() {
  scopeCounter += 1
  act(() => {
    emitOrganizationScopeChanged({
      organizationId: `org-${scopeCounter}`,
      tenantId: 'tenant-1',
    })
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('useSalesDocumentPermissions', () => {
  it('maps granted features to flags and asks for all seven in one call', async () => {
    apiCallMock.mockResolvedValue(grantedResponse(['sales.orders.manage', 'sales.returns.create']))

    const { result } = renderHook(() => useSalesDocumentPermissions())

    await waitFor(() => expect(result.current.canManageOrders).toBe(true))
    expect(result.current).toEqual({
      canEditNumber: false,
      canManageOrders: true,
      canManageQuotes: false,
      canManagePayments: false,
      canManageShipments: false,
      canCreateReturns: true,
      canManageReturns: false,
    })
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    const [, init] = apiCallMock.mock.calls[0]
    expect(JSON.parse((init as { body: string }).body)).toEqual({ features: ALL_FEATURES })
  })

  it('reports a non-2xx answer as unresolved, not as a denial', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, result: null })

    const { result } = renderHook(() => useSalesDocumentPermissions())

    // waitFor cannot await "flags stayed null", so wait for the call itself to have resolved.
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(result.current.canManageOrders).toBeNull()
    expect(result.current.canManageQuotes).toBeNull()
    expect(result.current.canEditNumber).toBe(false)
  })

  it('fails closed the moment the organization scope changes, before the re-check answers', async () => {
    apiCallMock.mockResolvedValue(grantedResponse(ALL_FEATURES))

    const { result } = renderHook(() => useSalesDocumentPermissions())
    await waitFor(() => expect(result.current.canManageOrders).toBe(true))

    // The next feature-check never answers within this assertion window — exactly the round trip
    // during which the previous organization's grants must not keep driving the affordances.
    const gate = deferred<ReturnType<typeof grantedResponse>>()
    apiCallMock.mockImplementation(() => gate.promise)

    switchScope()

    expect(result.current).toEqual({
      canEditNumber: false,
      canManageOrders: null,
      canManageQuotes: null,
      canManagePayments: null,
      canManageShipments: null,
      canCreateReturns: null,
      canManageReturns: null,
    })

    // The new scope's answer (no grants at all) lands and is what the flags resolve to —
    // never the previous scope's `true`s.
    await act(async () => {
      gate.resolve(grantedResponse([]))
    })
    await waitFor(() => expect(result.current.canManageOrders).toBe(false))
    expect(result.current.canManageQuotes).toBe(false)
  })
})
