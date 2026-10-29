/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const fetchCustomFieldFormStructureMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: (...args: unknown[]) => fetchCustomFieldFormStructureMock(...args),
}))

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
})
