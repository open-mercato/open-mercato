/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const fetchCustomFieldFormStructureMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: (...args: unknown[]) => fetchCustomFieldFormStructureMock(...args),
}))

import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { clearCalendarCustomFieldsCache, useCalendarCustomFields } from '../useCalendarCustomFields'

const NO_FIELDSETS: readonly string[] = []
const notes = { key: 'visit_notes', kind: 'text', label: 'Visit notes' }

describe('useCalendarCustomFields', () => {
  beforeEach(() => {
    fetchCustomFieldFormStructureMock.mockReset()
    clearCalendarCustomFieldsCache()
  })

  it('loads the structure on open and serves later opens from the cache while revalidating', async () => {
    fetchCustomFieldFormStructureMock.mockResolvedValue({ definitions: [notes] })
    const first = renderHook(() => useCalendarCustomFields(true, 'customers:customer_interaction', NO_FIELDSETS))
    expect(first.result.current.status).toBe('loading')
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(first.result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    first.unmount()

    const second = renderHook(() => useCalendarCustomFields(true, 'customers:customer_interaction', NO_FIELDSETS))
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    await waitFor(() => expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(2))
    await act(async () => {})

    const other = renderHook(() => useCalendarCustomFields(true, 'customers:other_entity', NO_FIELDSETS))
    expect(other.result.current.status).toBe('loading')
    await waitFor(() => expect(other.result.current.status).toBe('ready'))
  })

  it('warms the cache for a closed editor and revalidates on open', async () => {
    fetchCustomFieldFormStructureMock.mockResolvedValue({ definitions: [notes] })
    const { result, rerender } = renderHook(({ open }) => useCalendarCustomFields(open, 'customers:customer_interaction', NO_FIELDSETS), { initialProps: { open: false } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)
    rerender({ open: true })
    expect(result.current.status).toBe('ready')
    await waitFor(() => expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(2))
  })

  it('reports a failed load without a cached structure', async () => {
    fetchCustomFieldFormStructureMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCalendarCustomFields(true, 'customers:customer_interaction', NO_FIELDSETS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.fields).toEqual([])
  })

  it('keeps definitions apart per organization and drops a response from the previous one', async () => {
    const orgA = { tenantId: 'tenant-1', organizationId: 'org-a' }
    const orgB = { tenantId: 'tenant-1', organizationId: 'org-b' }
    act(() => emitOrganizationScopeChanged(orgA))

    fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [notes] })
    const { result } = renderHook(() => useCalendarCustomFields(true, 'customers:customer_interaction', NO_FIELDSETS))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.allDefinitions).toHaveLength(1)

    let resolveLate: (value: unknown) => void = () => {}
    fetchCustomFieldFormStructureMock.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve }))
    act(() => emitOrganizationScopeChanged(orgB))
    expect(result.current.status).toBe('loading')
    expect(result.current.allDefinitions).toEqual([])

    fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [] })
    act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-1', organizationId: 'org-c' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { resolveLate({ definitions: [notes] }) })
    expect(result.current.allDefinitions).toEqual([])
  })

  describe('when the organization scope resolves after the first load', () => {
    const entityId = 'customers:customer_interaction'

    beforeEach(() => {
      act(() => emitOrganizationScopeChanged({ tenantId: null, organizationId: null }))
    })

    it('keeps the loaded structure ready instead of remounting an open form, then revalidates', async () => {
      fetchCustomFieldFormStructureMock.mockResolvedValue({ definitions: [notes] })
      const statuses: string[] = []
      const { result } = renderHook(() => {
        const customFields = useCalendarCustomFields(true, entityId, NO_FIELDSETS)
        statuses.push(customFields.status)
        return customFields
      })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      statuses.length = 0

      act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-a', organizationId: 'org-a' }))

      await waitFor(() => expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(2))
      await act(async () => {})
      expect(statuses).not.toContain('loading')
      expect(result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    })

    it('fails closed when the first read under the reported scope fails', async () => {
      fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [notes] })
      const { result } = renderHook(() => useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      fetchCustomFieldFormStructureMock.mockRejectedValueOnce(new Error('offline'))
      act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-a', organizationId: 'org-a' }))

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.fields).toEqual([])
    })
  })
})
