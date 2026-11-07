/** @jest-environment jsdom */

import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { buildInteractionPayload, createDefaultFormState } from '../editorPayload'

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }

describe('createDefaultFormState under a configured display time zone', () => {
  afterEach(() => setClientDateLocaleSettings(null))

  it('saves the slot the user picked on the browser-local grid, not the same wall time in the configured zone', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'Pacific/Kiritimati' }, env: noEnv }))
    const start = new Date(2026, 5, 12, 10, 0, 0)
    const end = new Date(2026, 5, 12, 11, 0, 0)

    const state = createDefaultFormState(null, new Date(2026, 5, 12, 9, 0, 0), { start, end })
    const payload = buildInteractionPayload(
      { ...state, entityId: '11111111-1111-4111-8111-111111111111', title: 'Sync' },
      { mode: 'create' },
    )

    expect(state.timezone).toBe('Pacific/Kiritimati')
    expect(payload.scheduledAt).toBe(start.toISOString())
    expect(payload.durationMinutes).toBe(60)
  })

  it('shows the picked slot as wall time in the configured zone', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'UTC' }, env: noEnv }))
    const start = new Date('2026-06-12T14:00:00.000Z')
    const end = new Date('2026-06-12T15:30:00.000Z')

    const state = createDefaultFormState(null, start, { start, end })

    expect(state).toMatchObject({ date: '2026-06-12', startTime: '14:00', endDate: '2026-06-12', endTime: '15:30' })
  })

  it('opens a whole-day click on the grid day, at the next hour in the configured zone', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'Pacific/Kiritimati' }, env: noEnv }))
    const clickedDay = new Date(2026, 5, 20)
    const now = new Date('2026-06-12T14:12:00.000Z')

    const state = createDefaultFormState(clickedDay, now)

    // 14:12Z is 04:12 next day in Kiritimati (UTC+14): next hour 05:00, kept on the clicked day.
    expect(state).toMatchObject({ date: '2026-06-20', startTime: '05:00', endDate: '2026-06-20', endTime: '06:30' })
    // 2026-06-20 is a Saturday: the weekly repeat defaults to the clicked day, not a browser-zone shift.
    expect(state.repeatDays).toEqual([false, false, false, false, false, true, false])
  })

  it('rolls the default end over midnight in the configured zone', () => {
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: 'UTC' }, env: noEnv }))

    const state = createDefaultFormState(null, new Date('2026-06-12T22:40:00.000Z'))

    expect(state).toMatchObject({ date: '2026-06-12', startTime: '23:00', endDate: '2026-06-13', endTime: '00:30' })
  })
})
