/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { calendarEventTypes } from '../../../../calendar-event-types'
import type { ScopedCalendarEventType } from '../../../../lib/calendar/eventTypeResolver'

const readApiResultOrThrowMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

import { eventTypeConfig, eventTypeOptions, selectedEventType, useEventTypeCatalog } from '../useEventTypeCatalog'

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
    expect(eventTypeOptions(items, 'hidden').map((option) => option.value)).toEqual(['hidden', 'early', 'late'])
    expect(eventTypeOptions(items, 'early').map((option) => option.value)).toEqual(['early', 'late'])
    expect(selectedEventType(items, 'removed').historical).toBe(true)
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
