import * as fs from 'node:fs'
import * as path from 'node:path'

// Regression for issue #3748: every `staff.timesheets.*` key existed in all four
// locale files, but es.json and de.json carried the English string verbatim as
// the value, so `/backend/staff/timesheets` rendered fully in English for a
// Spanish or German session. `i18n:check-sync` cannot see this — the keys are in
// sync, only the values were untranslated — so this test guards the values.
//
// This also subsumes the narrower timer-error guard added for issue #3507
// (BUG-001), which covered five keys that all live under `staff.timesheets.`:
// `widgets.timeReporting.{startError,stopError,error}` and
// `my.timer.{startError,stopError}`. They are still guarded here, by prefix.
//
// Keys whose English value is not a word (a number, a sample code) are language
// neutral and stay identical everywhere.
const LANGUAGE_NEUTRAL = new Set([
  'staff.timesheets.my.durationPlaceholder', // "0"
  'staff.timesheets.projects.form.codePlaceholder', // "PROJECT-001"
  'staff.timesheets.projects.detail.costBasis', // "{hours} × {rate}" — placeholders and a multiplication sign
])

// Real words that are genuinely spelled the same in the target language. Adding
// a key here is a translation decision, not a way to silence the test.
//
// Note this covers the `staff.timesheets.` namespace only. Same-word values
// elsewhere in the module (German "Details"/"Person"/"Region", Spanish
// "Color"/"Roles", the "Cmd/Ctrl + Enter" shortcut) are outside this test's
// prefix and are not listed here.
const SAME_IN_LOCALE: Record<string, Set<string>> = {
  pl: new Set([
    'staff.timesheets.my.status', // "Status"
    'staff.timesheets.projects.employees.status',
    'staff.timesheets.projects.form.status',
    'staff.timesheets.projects.table.status',
  ]),
  es: new Set([
    'staff.timesheets.my.total', // "Total"
    'staff.timesheets.widgets.hoursByProject.total',
    'staff.timesheets.projects.detail.no', // "No"
  ]),
  de: new Set([
    'staff.timesheets.my.status', // "Status"
    'staff.timesheets.projects.employees.status',
    'staff.timesheets.projects.form.status',
    'staff.timesheets.projects.table.status',
    'staff.timesheets.projects.form.code', // "Code"
    'staff.timesheets.projects.form.name', // "Name"
    'staff.timesheets.projects.table.name',
    'staff.timesheets.projects.portfolio.team', // "Team"
    'staff.timesheets.projects.detail.tabTeam',
    'staff.timesheets.projects.detail.details', // "Details"
    'staff.timesheets.projects.detail.colWho', // "Person"
    'staff.timesheets.projects.form.budget', // "Budget"
    'staff.timesheets.projects.detail.budgetBadge', // "Budget {percent}%"
  ]),
}

// Translated in the same change as the timesheets surface, so guarded here even
// though they sit outside the `staff.timesheets.` prefix.
const LEAVE_REQUEST_MESSAGE_KEYS = [
  'staff.leaveRequests.messages.compose.action',
  'staff.leaveRequests.messages.compose.body',
  'staff.leaveRequests.messages.compose.subject',
  'staff.leaveRequests.messages.contextTitle',
] as const

const LOCALES = ['pl', 'de', 'es'] as const

function loadLocale(locale: string): Record<string, string> {
  const file = path.join(__dirname, '..', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
}

function placeholdersIn(value: string): string[] {
  return (value.match(/\{\{[a-zA-Z0-9_]+\}\}|\{[a-zA-Z0-9_]+\}/g) ?? []).sort()
}

describe('staff timesheets translations', () => {
  const en = loadLocale('en')
  const timesheetKeys = Object.keys(en).filter((key) => key.startsWith('staff.timesheets.'))

  it('covers the whole timesheets surface', () => {
    expect(timesheetKeys.length).toBeGreaterThan(200)
  })

  it.each(LOCALES)('%s translates every timesheets key away from English', (locale) => {
    const messages = loadLocale(locale)
    const allowed = SAME_IN_LOCALE[locale]
    const untranslated = timesheetKeys.filter(
      (key) => messages[key] === en[key] && !LANGUAGE_NEUTRAL.has(key) && !allowed.has(key),
    )

    expect(untranslated).toEqual([])
  })

  it.each(LOCALES)('%s allowlists only keys that are still identical', (locale) => {
    const messages = loadLocale(locale)
    const stale = [...SAME_IN_LOCALE[locale]].filter((key) => messages[key] !== en[key])

    expect(stale).toEqual([])
  })

  it.each(LOCALES)('%s has a non-empty value for every timesheets key', (locale) => {
    const messages = loadLocale(locale)
    for (const key of timesheetKeys) {
      expect(typeof messages[key]).toBe('string')
      expect(messages[key].trim().length).toBeGreaterThan(0)
    }
  })

  it.each(LOCALES)('%s preserves interpolation placeholders', (locale) => {
    const messages = loadLocale(locale)
    for (const key of timesheetKeys) {
      expect(placeholdersIn(messages[key])).toEqual(placeholdersIn(en[key]))
    }
  })
})

describe('staff leave-request message translations', () => {
  const en = loadLocale('en')

  it.each(LOCALES)('%s translates every leave-request message key', (locale) => {
    const messages = loadLocale(locale)
    for (const key of LEAVE_REQUEST_MESSAGE_KEYS) {
      expect(typeof messages[key]).toBe('string')
      expect(messages[key].trim().length).toBeGreaterThan(0)
      expect(messages[key]).not.toBe(en[key])
      expect(placeholdersIn(messages[key])).toEqual(placeholdersIn(en[key]))
    }
  })
})
