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
})
