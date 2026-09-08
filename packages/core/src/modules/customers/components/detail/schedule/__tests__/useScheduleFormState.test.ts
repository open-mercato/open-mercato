/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { useScheduleFormState } from '../useScheduleFormState'
import type { ScheduleActivityEditData } from '../useScheduleFormState'

function localDate(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const scheduledAt = '2026-07-24T14:30:00.000Z'
const occurredAt = '2026-07-01T08:00:00.000Z'

const editDataWithBothTimestamps: ScheduleActivityEditData = {
  id: 'act-1',
  interactionType: 'meeting',
  scheduledAt,
  occurredAt,
}

const editDataHistoricalOnly: ScheduleActivityEditData = {
  id: 'act-2',
  interactionType: 'call',
  scheduledAt: null,
  occurredAt,
}

describe('useScheduleFormState edit prefill', () => {
  it('seeds date/time from scheduledAt when both timestamps are present', () => {
    const { result } = renderHook(() =>
      useScheduleFormState({ open: true, editData: editDataWithBothTimestamps }),
    )

    expect(result.current.date).toBe(localDate(scheduledAt))
    expect(result.current.startTime).toBe(localTime(scheduledAt))
  })

  it('falls back to occurredAt for historical activities without a schedule (#1807)', () => {
    const { result } = renderHook(() =>
      useScheduleFormState({ open: true, editData: editDataHistoricalOnly }),
    )

    expect(result.current.date).toBe(localDate(occurredAt))
    expect(result.current.startTime).toBe(localTime(occurredAt))
  })
})
