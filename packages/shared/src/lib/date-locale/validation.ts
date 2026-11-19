import { z } from 'zod'
import { canonicalizeTimeZone } from '../date/timezone'
import { DATE_LOCALE_AUTO, FIRST_DAY_OF_WEEK_VALUES } from './presets'
import type { FirstDayOfWeek } from './types'

const SYSTEM_FORMAT_VALUES = new Set([DATE_LOCALE_AUTO, 'default', 'locale', 'system'])

export const DATE_FORMAT_PATTERN_MAX_LENGTH = 64

/**
 * Normalizes a configured pattern to `date-fns` tokens, or `null` for "follow the locale".
 * Legacy Moment-style `YYYY` / `YY` / `DD` become `yyyy` / `yy` / `dd`.
 */
export function normalizeDateFormatPattern(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (SYSTEM_FORMAT_VALUES.has(trimmed.toLowerCase())) return null
  // Quoted literals (`'Day' DD`) are copied as-is; only the tokens outside quotes are rewritten.
  return trimmed
    .split(/('(?:[^']|'')*'?)/)
    .map((part) => (part.startsWith("'") ? part : part.replace(/YYYY/g, 'yyyy').replace(/YY/g, 'yy').replace(/DD/g, 'dd')))
    .join('')
}

// `date-fns` format tokens that render without extra options. `Y` (week-numbering year) and
// `D` (day of year) are deliberately excluded: `date-fns` throws on them unless the caller opts
// in, and in practice they are always a mistyped `y` / `d`.
const ALLOWED_TOKEN_LETTERS = new Set('GyRuQqMLwIdEecibBahHKkmsSXxOzTtPp'.split(''))
// `o` is only a suffix: `do` renders "5th", `Mo` "1st". On its own `date-fns` throws.
const ORDINAL_TOKEN_LETTERS = new Set('yQqMLwIdecihHKkms'.split(''))
const ALLOWED_SEPARATOR = /^[\s.,/\-:()]$/

export type DateFormatPatternIssue = 'empty' | 'tooLong' | 'unterminatedQuote' | 'invalidToken' | 'invalidCharacter' | 'noToken'

/**
 * Structural check for a `date-fns` pattern: known tokens, common separators and `'quoted'`
 * literals only. Returns `null` when the pattern is safe to render.
 */
export function validateDateFormatPattern(pattern: string): DateFormatPatternIssue | null {
  if (!pattern.trim()) return 'empty'
  if (pattern.length > DATE_FORMAT_PATTERN_MAX_LENGTH) return 'tooLong'
  let inQuote = false
  let tokenCount = 0
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === "'") {
      if (pattern[index + 1] === "'") {
        index += 1
        continue
      }
      inQuote = !inQuote
      continue
    }
    if (inQuote) continue
    if (/[A-Za-z]/.test(char)) {
      if (char === 'o') {
        const previous = pattern[index - 1]
        const singleLetterToken = previous !== undefined && pattern[index - 2] !== previous
        if (!previous || !ORDINAL_TOKEN_LETTERS.has(previous) || !singleLetterToken) return 'invalidToken'
        continue
      }
      if (!ALLOWED_TOKEN_LETTERS.has(char)) return 'invalidToken'
      tokenCount += 1
      continue
    }
    if (!ALLOWED_SEPARATOR.test(char)) return 'invalidCharacter'
  }
  if (inQuote) return 'unterminatedQuote'
  if (tokenCount === 0) return 'noToken'
  return null
}

/**
 * The canonical spelling of a supported formatting locale (`en-us` → `en-US`), or `null`.
 *
 * Tags with Unicode (`-u-`) or private-use (`-x-`) extensions are rejected: an extension such as
 * `th-TH-u-ca-buddhist` switches the `Intl` calendar but not the `date-fns` one, so the year would
 * change depending on whether a custom pattern is set. For the same reason, locales whose default
 * `Intl` calendar is not Gregorian (`th-TH` → Buddhist, `fa-IR` → Persian) are rejected too.
 */
export function canonicalizeLocale(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new Intl.Locale(trimmed)
    if (parsed.toString() !== parsed.baseName) return null
    const [supported] = Intl.DateTimeFormat.supportedLocalesOf([trimmed])
    if (!supported) return null
    const calendar = new Intl.DateTimeFormat(supported).resolvedOptions().calendar
    return calendar === 'gregory' || calendar === 'iso8601' ? supported : null
  } catch {
    return null
  }
}

const WEEKDAY_NAMES: Record<string, FirstDayOfWeek> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

export function isFirstDayOfWeek(value: unknown): value is FirstDayOfWeek {
  return typeof value === 'number' && (FIRST_DAY_OF_WEEK_VALUES as readonly number[]).includes(value)
}

/** Parses `0`–`6` or an English weekday name (`monday`, `sun`); anything else is `null`. */
export function parseFirstDayOfWeek(value: string | number | null | undefined): FirstDayOfWeek | null {
  if (typeof value === 'number') return isFirstDayOfWeek(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || SYSTEM_FORMAT_VALUES.has(trimmed)) return null
  if (/^\d$/.test(trimmed)) return parseFirstDayOfWeek(Number(trimmed))
  return WEEKDAY_NAMES[trimmed] ?? null
}

// Length errors carry i18n keys too: the routes translate every issue message as a key.
const optionalText = (max: number, message: string) => z.string().trim().max(max, { message }).nullable().optional()

const patternField = optionalText(DATE_FORMAT_PATTERN_MAX_LENGTH, 'configs.dateLocale.errors.pattern.tooLong').superRefine((value, ctx) => {
  const normalized = normalizeDateFormatPattern(value)
  if (!normalized) return
  const issue = validateDateFormatPattern(normalized)
  if (issue) ctx.addIssue({ code: 'custom', message: `configs.dateLocale.errors.pattern.${issue}` })
})

/**
 * Tenant settings payload. Messages are i18n keys so `CrudForm` and API clients can translate them;
 * the keys (`configs.dateLocale.errors.*`, `auth.profile.errors.timeZone`) are translated by the
 * modules that own these settings, and every route using these schemas must translate the issue
 * messages before returning them.
 * Stored values are normalized (`auto` / blank → `null`, canonical zone and locale spellings).
 */
export const dateLocaleSettingsInputSchema = z
  .object({
    locale: optionalText(35, 'configs.dateLocale.errors.locale').refine((value) => !value || value === DATE_LOCALE_AUTO || canonicalizeLocale(value) !== null, {
      message: 'configs.dateLocale.errors.locale',
    }),
    dateFormat: patternField,
    dateTimeFormat: patternField,
    timeFormat: patternField,
    timeZone: optionalText(64, 'configs.dateLocale.errors.timeZone').refine((value) => !value || value === DATE_LOCALE_AUTO || canonicalizeTimeZone(value) !== null, {
      message: 'configs.dateLocale.errors.timeZone',
    }),
    firstDayOfWeek: z
      .union([z.number().int().min(0).max(6), z.literal(DATE_LOCALE_AUTO)])
      .nullable()
      .optional(),
  })
  .strict()
  .transform((input) => ({
    locale: input.locale && input.locale !== DATE_LOCALE_AUTO ? canonicalizeLocale(input.locale) : null,
    dateFormat: normalizeDateFormatPattern(input.dateFormat),
    dateTimeFormat: normalizeDateFormatPattern(input.dateTimeFormat),
    timeFormat: normalizeDateFormatPattern(input.timeFormat),
    timeZone: input.timeZone && input.timeZone !== DATE_LOCALE_AUTO ? canonicalizeTimeZone(input.timeZone) : null,
    firstDayOfWeek: typeof input.firstDayOfWeek === 'number' ? (input.firstDayOfWeek as FirstDayOfWeek) : null,
  }))

export type NormalizedDateLocaleSettings = z.output<typeof dateLocaleSettingsInputSchema>

export const userTimeZoneSchema = z
  .string()
  .trim()
  .max(64, { message: 'auth.profile.errors.timeZone' })
  .nullable()
  .optional()
  .refine((value) => !value || canonicalizeTimeZone(value) !== null, { message: 'auth.profile.errors.timeZone' })
  .transform((value) => (value ? canonicalizeTimeZone(value) : value === undefined ? undefined : null))
