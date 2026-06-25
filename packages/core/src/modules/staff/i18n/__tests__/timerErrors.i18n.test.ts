import * as fs from 'node:fs'
import * as path from 'node:path'

// Regression for issue #3507 (BUG-001): the timer error keys shipped the
// English string verbatim in every non-English locale, so a rejected start in
// a PL/DE/ES session showed "Failed to start timer". These keys MUST stay
// translated in each non-English locale.
const TIMER_ERROR_KEYS = [
  'staff.timesheets.widgets.timeReporting.startError',
  'staff.timesheets.widgets.timeReporting.stopError',
  'staff.timesheets.widgets.timeReporting.error',
  'staff.timesheets.my.timer.startError',
  'staff.timesheets.my.timer.stopError',
] as const

function loadLocale(locale: string): Record<string, string> {
  const file = path.join(__dirname, '..', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
}

describe('staff timer error translations', () => {
  const en = loadLocale('en')

  it.each(['pl', 'de', 'es'])('%s translates every timer error key away from English', (locale) => {
    const messages = loadLocale(locale)
    for (const key of TIMER_ERROR_KEYS) {
      const value = messages[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
      expect(value).not.toBe(en[key])
    }
  })
})
