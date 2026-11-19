/** @jest-environment jsdom */
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { formatDateBucketLabel } from '../formatters'

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }
const EN = 'en-US'

function configureTimeZone(timeZone: string): void {
  setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone }, env: noEnv }))
}

afterEach(() => setClientDateLocaleSettings(null))

describe('formatDateBucketLabel', () => {
  it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
    'labels the bucket calendar date regardless of the %s display zone',
    (timeZone) => {
      configureTimeZone(timeZone)
      expect(formatDateBucketLabel('2026-07-01T00:00:00.000Z', 'day', EN)).toBe('Jul 1')
      expect(formatDateBucketLabel('2026-07-01T00:00:00.000Z', 'week', EN)).toBe('Jul 1')
      expect(formatDateBucketLabel('2026-07-01T00:00:00.000Z', 'month', EN)).toBe('Jul 2026')
      expect(formatDateBucketLabel('2026-07-01T00:00:00.000Z', 'quarter', EN)).toBe('Q3 2026')
      expect(formatDateBucketLabel('2026-01-01T00:00:00.000Z', 'quarter', EN)).toBe('Q1 2026')
      expect(formatDateBucketLabel('2026-01-01T00:00:00.000Z', 'year', EN)).toBe('2026')
    },
  )

  it('renders a placeholder for a missing bucket', () => {
    expect(formatDateBucketLabel(null, 'month', EN)).toBe('--')
  })
})
