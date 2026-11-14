import * as fs from 'node:fs'
import * as path from 'node:path'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  staffTimeEntryBulkSaveSchema,
  staffTimeEntryUpdateSchema,
  staffTimeProjectUpdateSchema,
} from '../../data/validators'
import { localizeValidationIssues, parseWithLocalizedIssues } from '../validationIssues'

const ENTRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY = 'staff.validation.nonNegativeAmount'

function loadLocale(locale: string): Record<string, string> {
  const file = path.join(__dirname, '..', '..', 'i18n', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
}

function translatorFor(locale: string) {
  const dict = loadLocale(locale)
  return (key: string, fallback?: string) => dict[key] ?? fallback ?? key
}

function rejectedIssues(parse: () => unknown, locale: string) {
  let caught: unknown
  try {
    parseWithLocalizedIssues(parse, translatorFor(locale))
  } catch (err) {
    caught = err
  }
  expect(isCrudHttpError(caught)).toBe(true)
  const error = caught as CrudHttpError
  expect(error.status).toBe(400)
  return (error.body as { details: Array<{ path: PropertyKey[]; message: string }> }).details
}

describe('staff money validation messages', () => {
  const en = loadLocale('en')

  it.each(['pl', 'de', 'es', 'ko'])('%s translates the non-negative amount message', (locale) => {
    const value = loadLocale(locale)[KEY]
    expect(typeof value).toBe('string')
    expect(value).not.toBe(en[KEY])
  })

  it('localizes an invalid rate override on a time entry in Polish', () => {
    const details = rejectedIssues(
      () => staffTimeEntryUpdateSchema.parse({ id: ENTRY_ID, rateOverrideAmount: '-5' }),
      'pl',
    )
    expect(details).toEqual([expect.objectContaining({ path: ['rateOverrideAmount'], message: loadLocale('pl')[KEY] })])
  })

  it('localizes invalid project amounts in Polish', () => {
    const details = rejectedIssues(
      () => staffTimeProjectUpdateSchema.parse({ id: PROJECT_ID, hourlyRate: 'abc', budgetValue: '-1' }),
      'pl',
    )
    const message = loadLocale('pl')[KEY]
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['hourlyRate'], message }),
        expect.objectContaining({ path: ['budgetValue'], message }),
      ]),
    )
  })

  it('localizes an invalid rate override in a bulk save in German', () => {
    const parsed = staffTimeEntryBulkSaveSchema.safeParse({
      entries: [{ timeProjectId: PROJECT_ID, date: '2026-10-29', durationMinutes: 60, rateOverrideAmount: '-1' }],
    })
    expect(parsed.success).toBe(false)
    const issues = localizeValidationIssues(parsed.error!.issues, translatorFor('de'))
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: loadLocale('de')[KEY] })]),
    )
  })

  it('keeps messages without a dictionary entry and rethrows other errors as is', () => {
    expect(localizeValidationIssues([{ message: 'Invalid datetime' }], translatorFor('pl'))).toEqual([
      { message: 'Invalid datetime' },
    ])
    const failure = new Error('boom')
    expect(() =>
      parseWithLocalizedIssues(() => {
        throw failure
      }, translatorFor('pl')),
    ).toThrow(failure)
  })
})
