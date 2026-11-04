import {
  DATE_FORMAT_PRESETS,
  DATE_LOCALE_AUTO,
  DATE_TIME_FORMAT_PRESETS,
  TIME_FORMAT_PRESETS,
} from '@open-mercato/shared/lib/date-locale/presets'
import type { DateLocaleSettingsInput, FirstDayOfWeek, NormalizedDateLocaleSettingsRecord } from '@open-mercato/shared/lib/date-locale/types'

export const CUSTOM_PATTERN = 'custom'

export const PATTERN_FIELDS = [
  { id: 'dateFormat', presets: DATE_FORMAT_PRESETS },
  { id: 'dateTimeFormat', presets: DATE_TIME_FORMAT_PRESETS },
  { id: 'timeFormat', presets: TIME_FORMAT_PRESETS },
] as const

export type PatternFieldId = (typeof PATTERN_FIELDS)[number]['id']

export type DateLocaleFormValues = {
  locale: string
  timeZone: string
  firstDayOfWeek: string
  dateFormatMode: string
  dateFormatCustom: string
  dateTimeFormatMode: string
  dateTimeFormatCustom: string
  timeFormatMode: string
  timeFormatCustom: string
  updatedAt?: string | null
}

function patternMode(value: string | null, presets: readonly string[]): { mode: string; custom: string } {
  if (!value) return { mode: DATE_LOCALE_AUTO, custom: '' }
  if (presets.includes(value)) return { mode: value, custom: '' }
  return { mode: CUSTOM_PATTERN, custom: value }
}

export function buildDateLocaleFormValues(
  settings: NormalizedDateLocaleSettingsRecord,
  updatedAt: string | null,
): DateLocaleFormValues {
  const values: DateLocaleFormValues = {
    locale: settings.locale ?? DATE_LOCALE_AUTO,
    timeZone: settings.timeZone ?? DATE_LOCALE_AUTO,
    firstDayOfWeek: settings.firstDayOfWeek === null ? DATE_LOCALE_AUTO : String(settings.firstDayOfWeek),
    dateFormatMode: DATE_LOCALE_AUTO,
    dateFormatCustom: '',
    dateTimeFormatMode: DATE_LOCALE_AUTO,
    dateTimeFormatCustom: '',
    timeFormatMode: DATE_LOCALE_AUTO,
    timeFormatCustom: '',
    updatedAt,
  }
  for (const field of PATTERN_FIELDS) {
    const { mode, custom } = patternMode(settings[field.id], field.presets)
    values[`${field.id}Mode`] = mode
    values[`${field.id}Custom`] = custom
  }
  return values
}

function readPattern(values: Partial<DateLocaleFormValues>, id: PatternFieldId): string | null {
  const mode = values[`${id}Mode`]
  if (!mode || mode === DATE_LOCALE_AUTO) return null
  if (mode === CUSTOM_PATTERN) {
    const custom = values[`${id}Custom`]?.trim()
    return custom ? custom : null
  }
  return mode
}

function readChoice(value: string | undefined): string | null {
  return value && value !== DATE_LOCALE_AUTO ? value : null
}

export function buildDateLocalePayload(values: Partial<DateLocaleFormValues>): DateLocaleSettingsInput {
  const firstDay = readChoice(values.firstDayOfWeek)
  return {
    locale: readChoice(values.locale),
    timeZone: readChoice(values.timeZone),
    firstDayOfWeek: firstDay === null ? null : (Number(firstDay) as FirstDayOfWeek),
    dateFormat: readPattern(values, 'dateFormat'),
    dateTimeFormat: readPattern(values, 'dateTimeFormat'),
    timeFormat: readPattern(values, 'timeFormat'),
  }
}

/** Maps API field errors (keyed by stored field) onto the form controls that edit them. */
export function remapDateLocaleFieldErrors(fieldErrors: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fieldErrors) return undefined
  const mapped: Record<string, string> = {}
  for (const [key, message] of Object.entries(fieldErrors)) {
    const pattern = PATTERN_FIELDS.find((field) => field.id === key)
    mapped[pattern ? `${pattern.id}Custom` : key] = message
  }
  return mapped
}
