/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import { useWmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
}))

const mockApiCall = apiCall as jest.Mock

describe('useWmsInventoryMutationAccess', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('requests wms.manage_locations so canManageLocations can ever be true', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { granted: ['wms.manage_locations'], userId: 'user-1' } })
    const { result } = renderHook(() => useWmsInventoryMutationAccess())

    await waitFor(() => expect(result.current.loading).toBe(false))

    const [, options] = mockApiCall.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.features).toContain('wms.manage_locations')

    // Regression check for #4106: canManageLocations must be derivable from the
    // feature check response — it was always false before because the feature
    // was never included in the request payload above.
    expect(result.current.canManageLocations).toBe(true)
  })

  it('resolves canManageLocations to false when the feature is not granted', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { granted: [], userId: 'user-1' } })
    const { result } = renderHook(() => useWmsInventoryMutationAccess())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.canManageLocations).toBe(false)
  })
})
