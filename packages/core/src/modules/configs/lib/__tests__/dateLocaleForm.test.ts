import { buildDateLocaleFormValues, buildDateLocalePayload, remapDateLocaleFieldErrors } from '../dateLocaleForm'
import { normalizeStoredDateLocaleSettings } from '../date-locale-settings'

const empty = {
  locale: null,
  dateFormat: null,
  dateTimeFormat: null,
  timeFormat: null,
  timeZone: null,
  firstDayOfWeek: null,
}

describe('date-locale form mapping', () => {
  it('maps unset settings to automatic choices', () => {
    const values = buildDateLocaleFormValues(empty, null)
    expect(values).toMatchObject({
      locale: 'auto',
      timeZone: 'auto',
      firstDayOfWeek: 'auto',
      dateFormatMode: 'auto',
      dateFormatCustom: '',
      updatedAt: null,
    })
    expect(buildDateLocalePayload(values)).toEqual(empty)
  })

  it('round-trips presets and custom patterns', () => {
    const stored = {
      ...empty,
      dateFormat: 'dd.MM.yyyy',
      timeFormat: "HH'h'mm",
      timeZone: 'Europe/Warsaw',
      firstDayOfWeek: 1 as const,
    }
    const values = buildDateLocaleFormValues(stored, '2026-11-01T10:00:00.000Z')
    expect(values.dateFormatMode).toBe('dd.MM.yyyy')
    expect(values.timeFormatMode).toBe('custom')
    expect(values.timeFormatCustom).toBe("HH'h'mm")
    expect(values.firstDayOfWeek).toBe('1')
    expect(buildDateLocalePayload(values)).toEqual(stored)
  })

  it('treats a blank custom pattern as automatic', () => {
    expect(buildDateLocalePayload({ dateFormatMode: 'custom', dateFormatCustom: '  ' }).dateFormat).toBeNull()
  })

  it('moves pattern errors onto the custom pattern input', () => {
    expect(remapDateLocaleFieldErrors({ dateFormat: 'bad', timeZone: 'bad zone' })).toEqual({
      dateFormatCustom: 'bad',
      timeZone: 'bad zone',
    })
    expect(remapDateLocaleFieldErrors(undefined)).toBeUndefined()
  })
})

describe('normalizeStoredDateLocaleSettings', () => {
  it('drops fields that no longer validate and keeps the rest', () => {
    expect(
      normalizeStoredDateLocaleSettings({ timeZone: 'Mars/Olympus', dateFormat: 'dd.MM.yyyy', firstDayOfWeek: 9, extra: true }),
    ).toEqual({ ...empty, dateFormat: 'dd.MM.yyyy' })
  })

  it('returns empty settings for a non-object value', () => {
    expect(normalizeStoredDateLocaleSettings('nope')).toEqual(empty)
    expect(normalizeStoredDateLocaleSettings(null)).toEqual(empty)
  })
})
