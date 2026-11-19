import type { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DisplaySettings } from '@open-mercato/ui/primitives/date-format'
import { formatTimelineTimestamp, timelineDayLabel } from '../backend/processes/timelineDates'

const settings: DisplaySettings = {
  locale: 'en-GB',
  dateFormat: 'yyyy-MM-dd',
  dateTimeFormat: null,
  timeFormat: 'HH:mm',
  timeZone: 'America/Los_Angeles',
}
const t: ReturnType<typeof useT> = (key) => key

describe('process timeline display dates', () => {
  it.each([
    ['2026-07-02T02:05:00Z', '2026-07-01', '19:05'],
    ['2026-01-02T02:05:00Z', '2026-01-01', '18:05'],
  ])('uses one display zone for the day and clock at %s', (iso, day, time) => {
    expect(formatTimelineTimestamp(iso, 'en', settings)).toEqual({ day, time })
  })

  it('recomputes the day and clock for changed settings', () => {
    const iso = '2026-07-02T02:05:00Z'
    expect(formatTimelineTimestamp(iso, 'en', { ...settings, timeZone: 'Asia/Tokyo' }))
      .toEqual({ day: '2026-07-02', time: '11:05' })
  })

  it.each([
    ['2026-03-09T04:30:00Z', '2026-03-09', '2026-03-08', '2026-03-07'],
    ['2026-11-02T04:30:00Z', '2026-11-01', '2026-10-31', '2026-10-30'],
    ['2027-01-01T05:30:00Z', '2027-01-01', '2026-12-31', '2026-12-30'],
  ])('labels the previous calendar day across DST and year boundaries at %s', (instant, today, yesterday, older) => {
    const dateSettings = { ...settings, timeZone: 'America/New_York' }
    const now = new Date(instant)
    expect(timelineDayLabel(today, t, 'en', dateSettings, now)).toBe('agent_orchestrator.process.today')
    expect(timelineDayLabel(yesterday, t, 'en', dateSettings, now)).toBe('agent_orchestrator.process.yesterday')
    expect(timelineDayLabel(older, t, 'en', dateSettings, now)).toBe(older)
  })

  it('preserves empty and invalid timestamp fallbacks', () => {
    expect(formatTimelineTimestamp(null, 'en', settings)).toEqual({ day: '', time: '' })
    expect(formatTimelineTimestamp('invalid', 'en', settings)).toEqual({ day: 'invalid', time: '' })
  })
})
