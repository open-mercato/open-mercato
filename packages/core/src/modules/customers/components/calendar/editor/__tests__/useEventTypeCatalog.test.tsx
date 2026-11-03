/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { calendarEventTypes } from '../../../../calendar-event-types'
import type { ScopedCalendarEventType } from '../../../../lib/calendar/eventTypeResolver'

const readApiResultOrThrowMock = jest.fn()
const reportErrorMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { clearEventTypeCatalogCache, eventTypeConfig, eventTypeOptions, isSelectableEventType, selectedEventType, useEventTypeCatalog } from '../useEventTypeCatalog'

function scopedType(key: string, order: number, selectable = true): ScopedCalendarEventType {
  return {
    ...calendarEventTypes[0]!,
    key,
    label: key,
    behavior: { ...calendarEventTypes[0]!.behavior, order },
    selectable,
    source: 'customers',
    provenance: {},
    historical: false,
    adminConfigurable: true,
    isInherited: false,
    isLocalOverride: false,
    updatedAt: null,
    missingCustomFieldsetIds: [],
  }
}

describe('calendar editor scoped type catalog', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    reportErrorMock.mockReset()
    clearEventTypeCatalogCache()
  })

  it('orders selectable types and keeps an unavailable historical selection out of later choices', () => {
    const items = [scopedType('late', 20), scopedType('early', 10), scopedType('hidden', 0, false)]
    const translate = (key: string, fallback: string) => fallback
    expect(eventTypeOptions(items, 'hidden', translate).map((option) => option.value)).toEqual(['hidden', 'early', 'late'])
    expect(eventTypeOptions(items, 'early', translate).map((option) => option.value)).toEqual(['early', 'late'])
    expect(selectedEventType(items, 'removed').historical).toBe(true)
  })

  it('uses a patched label key for the visible type and preserved historical selection', () => {
    const meeting = { ...scopedType('meeting', 0), label: 'Meeting', labelKey: 'example.calendar.customerMeeting' }
    const hidden = { ...scopedType('hidden', 1, false), label: 'Old label', labelKey: 'example.calendar.oldLabel' }
    const translate = (key: string, fallback: string) => key === 'example.calendar.customerMeeting'
      ? 'Customer meeting'
      : key === 'example.calendar.oldLabel' ? 'Previous label' : fallback
    expect(eventTypeOptions([meeting], 'meeting', translate)[0]?.label).toBe('Customer meeting')
    expect(eventTypeOptions([meeting, hidden], 'hidden', translate)[0]?.label).toBe('Previous label')
  })

  it('uses the effective field behavior for the selected type', () => {
    const definition = scopedType('visit', 10)
    const custom = {
      ...definition,
      behavior: {
        ...definition.behavior,
        fields: { ...definition.behavior.fields, recurrence: false, location: 'none' as const, resources: false },
      },
    }
    expect(eventTypeConfig(custom)).toMatchObject({ hasRepeat: false, location: null })
  })

  it('resolves mixed-case stored keys with the configured behavior and keeps their selected value', () => {
    const type = { ...scopedType('site visit', 0), label: 'Site visit', behavior: { ...calendarEventTypes[0]!.behavior, fields: { ...calendarEventTypes[0]!.behavior.fields, endTime: false, priority: true } } }
    expect(selectedEventType([type], ' Site Visit ')).toBe(type)
    expect(eventTypeConfig(selectedEventType([type], ' Site Visit '))).toMatchObject({ hasEnd: false, hasPriority: true })
    expect(eventTypeOptions([type], ' Site Visit ', (_key, fallback) => fallback)).toEqual([{ value: ' Site Visit ', label: 'Site visit', icon: type.icon }])
    expect(isSelectableEventType([type], ' Site Visit ')).toBe(true)
    expect(isSelectableEventType([{ ...type, selectable: false }], ' Site Visit ')).toBe(false)
    expect(selectedEventType([], 'Task').behavior.baseKind).toBe('task')
  })

  it('loads once per open and retries after a catalog failure', async () => {
    const error = new Error('unavailable')
    readApiResultOrThrowMock.mockRejectedValueOnce(error)
      .mockResolvedValue({ items: [scopedType('visit', 10)], fallbackKey: 'meeting' })
    const { result, rerender } = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(error, {
      module: 'customers',
      code: 'customers.activity_type_catalog_load_failed',
    })
    await act(async () => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items[0]?.key).toBe('visit')
    rerender({ open: false })
    await act(async () => {})
    expect(result.current.status).toBe('ready')
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    rerender({ open: true })
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(3))
  })
  it('warms the cache while the editor is still closed and does not refetch until it opens', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [scopedType('visit', 10)], fallbackKey: 'meeting' })
    const { result, rerender } = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: false } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    rerender({ open: false })
    await act(async () => {})
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    rerender({ open: true })
    expect(result.current.status).toBe('ready')
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
  })

  it('reopens from the cached catalog and revalidates without re-rendering an unchanged catalog', async () => {
    const visit = scopedType('visit', 10)
    readApiResultOrThrowMock.mockResolvedValue({ items: [visit], fallbackKey: 'meeting' })
    const first = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    expect(first.result.current.status).toBe('loading')
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    first.unmount()

    const renders: string[] = []
    const second = renderHook(({ open }) => {
      const catalog = useEventTypeCatalog(open)
      renders.push(catalog.status)
      return catalog
    }, { initialProps: { open: true } })
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.items[0]?.key).toBe('visit')
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(renders.every((status) => status === 'ready')).toBe(true)
    expect(renders.length).toBe(1)

    readApiResultOrThrowMock.mockResolvedValue({ items: [visit, scopedType('call', 20)], fallbackKey: 'meeting' })
    const third = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    expect(third.result.current.items.map((item) => item.key)).toEqual(['visit'])
    await waitFor(() => expect(third.result.current.items.map((item) => item.key)).toEqual(['visit', 'call']))
    expect(third.result.current.status).toBe('ready')
  })

  describe('organization scope isolation', () => {
    const orgA = { tenantId: 'tenant-1', organizationId: 'org-a' }
    const orgB = { tenantId: 'tenant-1', organizationId: 'org-b' }

    beforeEach(() => {
      act(() => emitOrganizationScopeChanged(orgA))
    })

    it('never serves the previous organization catalog after a switch', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [scopedType('org-a-type', 1)] })
      const { result } = renderHook(() => useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(result.current.items.map((item) => item.key)).toEqual(['org-a-type'])

      let resolveB: (value: unknown) => void = () => {}
      readApiResultOrThrowMock.mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))
      act(() => emitOrganizationScopeChanged(orgB))

      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])

      await act(async () => { resolveB({ items: [scopedType('org-b-type', 1)] }) })
      await waitFor(() => expect(result.current.items.map((item) => item.key)).toEqual(['org-b-type']))
    })

    it('discards a response that was in flight when the organization changed', async () => {
      let resolveA: (value: unknown) => void = () => {}
      readApiResultOrThrowMock.mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
      const { result } = renderHook(() => useEventTypeCatalog(true))

      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [scopedType('org-b-type', 1)] })
      act(() => emitOrganizationScopeChanged(orgB))
      await waitFor(() => expect(result.current.items.map((item) => item.key)).toEqual(['org-b-type']))

      await act(async () => { resolveA({ items: [scopedType('org-a-late', 1)] }) })
      expect(result.current.items.map((item) => item.key)).toEqual(['org-b-type'])

      readApiResultOrThrowMock.mockReturnValueOnce(new Promise(() => {}))
      act(() => emitOrganizationScopeChanged(orgA))
      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])
    })

    it('reports an error instead of the old catalog when the new organization fails to load', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [scopedType('org-a-type', 1)] })
      const { result } = renderHook(() => useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      readApiResultOrThrowMock.mockRejectedValueOnce(new Error('boom'))
      act(() => emitOrganizationScopeChanged(orgB))
      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.items).toEqual([])
    })
  })

  describe('when the organization scope resolves after the first load', () => {
    const items = [scopedType('meeting', 0)]

    beforeEach(() => {
      act(() => emitOrganizationScopeChanged({ tenantId: null, organizationId: null }))
    })

    it('keeps the loaded catalog ready instead of remounting an open form, then revalidates', async () => {
      readApiResultOrThrowMock.mockResolvedValue({ items })
      const statuses: string[] = []
      const { result } = renderHook(() => {
        const catalog = useEventTypeCatalog(true)
        statuses.push(catalog.status)
        return catalog
      })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const loaded = result.current.items
      statuses.length = 0

      act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-a', organizationId: 'org-a' }))

      await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
      await act(async () => {})
      expect(statuses).not.toContain('loading')
      expect(result.current.status).toBe('ready')
      expect(result.current.items).toBe(loaded)
    })

    it('fails closed when the first read under the reported scope fails', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({ items })
      const { result } = renderHook(() => useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      readApiResultOrThrowMock.mockRejectedValueOnce(new Error('offline'))
      act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-a', organizationId: 'org-a' }))

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.items).toEqual([])
    })

    it('never carries a catalog across a later organization switch', async () => {
      readApiResultOrThrowMock.mockResolvedValue({ items })
      const { result } = renderHook(() => useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-a', organizationId: 'org-a' }))
      await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
      await act(async () => {})

      readApiResultOrThrowMock.mockReturnValue(new Promise(() => {}))
      act(() => emitOrganizationScopeChanged({ tenantId: 'tenant-a', organizationId: 'org-b' }))

      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])
    })
  })
})
