/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

const mockApiCall = jest.fn()
let mockScopeVersion = 0

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/shared/lib/frontend/organizationEvents', () => ({
  getCurrentOrganizationScopeVersion: () => mockScopeVersion,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))

import {
  findExplainResourceDescriptor,
  loadExplainDescriptors,
  resetExplainDescriptorsCache,
  useExplainResourceDescriptor,
} from '../useExplainDescriptors'
import { apiOk, apiStatus, dealDescriptor } from '../../../components/__tests__/fixtures'

describe('explain descriptors cache', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockScopeVersion = 0
    resetExplainDescriptorsCache()
  })

  it('fetches descriptors once per session and shares the promise', async () => {
    mockApiCall.mockResolvedValue(apiOk({ resources: [dealDescriptor()] }))
    const [first, second] = await Promise.all([loadExplainDescriptors(), loadExplainDescriptors()])
    const third = await loadExplainDescriptors()
    expect(mockApiCall).toHaveBeenCalledTimes(1)
    expect(String(mockApiCall.mock.calls[0][0])).toBe('/api/insights/explain/descriptors')
    expect(first).toBe(second)
    expect(third).toBe(first)
  })

  it('refetches after an organization scope change', async () => {
    mockApiCall.mockResolvedValue(apiOk({ resources: [dealDescriptor()] }))
    await loadExplainDescriptors()
    mockScopeVersion = 1
    await loadExplainDescriptors()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(500)).mockResolvedValueOnce(apiOk({ resources: [dealDescriptor()] }))
    await expect(loadExplainDescriptors()).rejects.toThrow()
    await expect(loadExplainDescriptors()).resolves.toHaveLength(1)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('treats a forbidden response as no explainable resources', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(403))
    await expect(loadExplainDescriptors()).resolves.toEqual([])
  })

  it('finds a descriptor by resource kind', () => {
    const resources = [dealDescriptor()]
    expect(findExplainResourceDescriptor(resources, 'customers.deal')?.labelKey).toBe('customers.insights.resources.deal')
    expect(findExplainResourceDescriptor(resources, 'sales.order')).toBeNull()
    expect(findExplainResourceDescriptor(resources, null)).toBeNull()
  })

  it('resolves the descriptor for a resource kind through the hook, without refetching across hooks', async () => {
    mockApiCall.mockResolvedValue(apiOk({ resources: [dealDescriptor()] }))
    const first = renderHook(() => useExplainResourceDescriptor('customers.deal'))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(first.result.current.descriptor?.resourceKind).toBe('customers.deal')
    const second = renderHook(() => useExplainResourceDescriptor('sales.order'))
    await waitFor(() => expect(second.result.current.status).toBe('ready'))
    expect(second.result.current.descriptor).toBeNull()
    expect(mockApiCall).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.unmount()
      second.unmount()
    })
  })

  it('starts ready from a warm cache without a loading frame', async () => {
    mockApiCall.mockResolvedValue(apiOk({ resources: [dealDescriptor()] }))
    await loadExplainDescriptors()
    const { result } = renderHook(() => useExplainResourceDescriptor('customers.deal'))
    expect(result.current.status).toBe('ready')
    expect(result.current.descriptor?.resourceKind).toBe('customers.deal')
    await act(async () => Promise.resolve())
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })

  it('does not fetch without a resource kind', async () => {
    const { result } = renderHook(() => useExplainResourceDescriptor(null))
    expect(result.current).toEqual({ status: 'ready', descriptor: null })
    await act(async () => Promise.resolve())
    expect(mockApiCall).not.toHaveBeenCalled()
  })
})

