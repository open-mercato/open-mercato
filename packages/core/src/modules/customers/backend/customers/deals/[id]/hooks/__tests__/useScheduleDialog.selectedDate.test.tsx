/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { useScheduleDialog } from '../useScheduleDialog'
import { useScheduleFormState } from '../../../../../../components/detail/schedule/useScheduleFormState'

function useScheduleHarness() {
  const dialog = useScheduleDialog()
  const form = useScheduleFormState({
    open: dialog.scheduleDialogOpen,
    editData: dialog.scheduleEditData,
  })
  return { dialog, form }
}

describe('useScheduleDialog selected-day form seeding (#7478)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 30, 14, 12))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('seeds the selected local day and replaces it with the next selection on reopen', () => {
    const { result } = renderHook(useScheduleHarness)

    act(() => {
      result.current.dialog.openSchedule(new Date(2026, 9, 1))
    })
    expect(result.current.dialog.scheduleEditData?.id).toBe('')
    expect(result.current.form.activityType).toBe('meeting')
    expect(result.current.form.date).toBe('2026-10-01')
    expect(result.current.form.startTime).toBe('09:00')

    act(() => {
      result.current.dialog.closeSchedule()
    })
    act(() => {
      result.current.dialog.openSchedule(new Date(2026, 7, 31))
    })
    expect(result.current.form.date).toBe('2026-08-31')
    expect(result.current.form.startTime).toBe('14:30')
  })

  it('returns to the current default when reopened without an explicit calendar day', () => {
    const { result } = renderHook(useScheduleHarness)

    act(() => {
      result.current.dialog.openSchedule(new Date(2026, 9, 1))
    })
    act(() => {
      result.current.dialog.closeSchedule()
    })
    act(() => {
      result.current.dialog.openSchedule()
    })

    expect(result.current.dialog.scheduleEditData).toBeNull()
    expect(result.current.form.date).toBe('2026-09-30')
    expect(result.current.form.startTime).toBe('14:30')
  })

  it('restores saved activity fields when editing after a calendar-seeded create', () => {
    const { result } = renderHook(useScheduleHarness)
    const existingActivity = {
      id: 'activity-1',
      interactionType: 'task',
      title: 'Saved task',
      scheduledAt: new Date(2026, 5, 12, 11, 15).toISOString(),
      reminderMinutes: 30,
    }

    act(() => {
      result.current.dialog.openSchedule(new Date(2026, 9, 1))
    })
    act(() => {
      result.current.dialog.closeSchedule()
    })
    act(() => {
      result.current.dialog.openEdit(existingActivity)
    })

    expect(result.current.dialog.scheduleEditData).toEqual(existingActivity)
    expect(result.current.form.activityType).toBe('task')
    expect(result.current.form.title).toBe('Saved task')
    expect(result.current.form.date).toBe('2026-06-12')
    expect(result.current.form.startTime).toBe('11:15')
    expect(result.current.form.reminderMinutes).toBe(30)
  })
})
