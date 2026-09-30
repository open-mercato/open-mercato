/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { calendarEventTypes } from '../../../../calendar-event-types'
import type { ScopedCalendarEventType } from '../../../../lib/calendar/eventTypeResolver'

const readApiResultOrThrowMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

import { eventTypeConfig, eventTypeOptions, isSelectableEventType, selectedEventType, useEventTypeCatalog } from '../useEventTypeCatalog'

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
  beforeEach(() => readApiResultOrThrowMock.mockReset())

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
    readApiResultOrThrowMock.mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ items: [scopedType('visit', 10)], fallbackKey: 'meeting' })
    const { result, rerender } = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    await act(async () => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items[0]?.key).toBe('visit')
    rerender({ open: false })
    await waitFor(() => expect(result.current.status).toBe('loading'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
  })
})
