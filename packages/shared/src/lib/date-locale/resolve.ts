import { canonicalizeTimeZone } from '../date/timezone'
import {
  canonicalizeLocale,
  isFirstDayOfWeek,
  normalizeDateFormatPattern,
  parseFirstDayOfWeek,
  validateDateFormatPattern,
} from './validation'
import type {
  DateLocaleEnvDefaults,
  DateLocaleField,
  DateLocaleSettingsInput,
  DateLocaleSource,
  FirstDayOfWeek,
  ResolvedDateLocaleSettings,
} from './types'

/** A normalized pattern that passes `validateDateFormatPattern`, or `null` (follow the locale). */
function safePattern(value: string | null | undefined): string | null {
  const normalized = normalizeDateFormatPattern(value)
  return normalized && validateDateFormatPattern(normalized) === null ? normalized : null
}

export type DateLocaleEnv = {
  OM_DEFAULT_LOCALE?: string
  OM_DEFAULT_TIMEZONE?: string
  OM_FIRST_DAY_OF_WEEK?: string
  NEXT_PUBLIC_OM_DATE_FORMAT?: string
  NEXT_PUBLIC_OM_DATE_TIME_FORMAT?: string
  NEXT_PUBLIC_OM_TIME_FORMAT?: string
  NEXT_PUBLIC_DATE_FORMAT?: string
  NEXT_PUBLIC_DATE_TIME_FORMAT?: string
}

/**
 * Reads the bootstrap defaults. Invalid values are ignored (treated as unset) rather than thrown:
 * these feed every page render, and a typo must degrade to the locale default, not an outage.
 *
 * `NEXT_PUBLIC_DATE_FORMAT` / `NEXT_PUBLIC_DATE_TIME_FORMAT` are kept as legacy aliases.
 */
export function readDateLocaleEnv(env: DateLocaleEnv = process.env as DateLocaleEnv): DateLocaleEnvDefaults {
  return {
    locale: canonicalizeLocale(env.OM_DEFAULT_LOCALE),
    dateFormat:
      safePattern(env.NEXT_PUBLIC_OM_DATE_FORMAT) ?? safePattern(env.NEXT_PUBLIC_DATE_FORMAT),
    dateTimeFormat:
      safePattern(env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT)
      ?? safePattern(env.NEXT_PUBLIC_DATE_TIME_FORMAT),
    timeFormat: safePattern(env.NEXT_PUBLIC_OM_TIME_FORMAT),
    timeZone: canonicalizeTimeZone(env.OM_DEFAULT_TIMEZONE),
    firstDayOfWeek: parseFirstDayOfWeek(env.OM_FIRST_DAY_OF_WEEK),
  }
}

export type ResolveDateLocaleSettingsInput = {
  /** The signed-in user's own timezone, if they set one. Only the timezone is user-overridable. */
  userTimeZone?: string | null
  tenant?: DateLocaleSettingsInput | null
  env?: DateLocaleEnvDefaults
}

type FieldValue<K extends DateLocaleField> = ResolvedDateLocaleSettings[K]

function pick<K extends DateLocaleField>(
  candidates: Array<[DateLocaleSource, FieldValue<K> | null | undefined]>,
): [FieldValue<K>, DateLocaleSource] {
  for (const [source, value] of candidates) {
    if (value !== null && value !== undefined) return [value as FieldValue<K>, source]
  }
  return [null as FieldValue<K>, 'fallback']
}

function tenantPattern(value: string | null | undefined): string | null {
  return safePattern(value)
}

/**
 * Resolves every field as `user → tenant → env → fallback` (tenant overrides env, decided in
 * `.ai/specs/2026-05-18-date-locale-settings.md` Q1). Only `timeZone` has a user layer (Q2).
 *
 * `dateTimeFormat` has one extra step before falling back: when no layer sets it but a date
 * pattern is in force, the date pattern is used, followed by the time pattern in force. A tenant
 * date pin also takes precedence over an env date-time pattern. Without a
 * time pattern, a tenant date pin is followed by date-fns' localized short time (`p`), so pinning
 * only `dd.MM.yyyy` keeps timestamps on that ordering with their time. An env-only date pin stays
 * bare, as `NEXT_PUBLIC_OM_DATE_FORMAT` rendered before tenant settings existed.
 */
export function resolveDateLocaleSettings({
  userTimeZone,
  tenant,
  env,
}: ResolveDateLocaleSettingsInput): ResolvedDateLocaleSettings {
  const defaults = env ?? readDateLocaleEnv()
  const stored = tenant ?? {}

  const [locale, localeSource] = pick<'locale'>([
    ['tenant', canonicalizeLocale(stored.locale)],
    ['env', defaults.locale],
  ])
  const [dateFormat, dateFormatSource] = pick<'dateFormat'>([
    ['tenant', tenantPattern(stored.dateFormat)],
    ['env', defaults.dateFormat],
  ])
  const [timeFormat, timeFormatSource] = pick<'timeFormat'>([
    ['tenant', tenantPattern(stored.timeFormat)],
    ['env', defaults.timeFormat],
  ])
  let [dateTimeFormat, dateTimeFormatSource] = pick<'dateTimeFormat'>([
    ['tenant', tenantPattern(stored.dateTimeFormat)],
    ['env', defaults.dateTimeFormat],
  ])
  // Tenant overrides env (Q1) field by field: an env date-time pattern must not outrank a tenant
  // date pin, or dates would follow the tenant and timestamps the deployment.
  const envDateTimeUnderTenantDate = dateTimeFormatSource === 'env' && dateFormatSource === 'tenant'
  if ((dateTimeFormat === null || envDateTimeUnderTenantDate) && dateFormat !== null) {
    const timePart = timeFormat ?? (dateFormatSource === 'tenant' ? 'p' : null)
    dateTimeFormat = timePart ? `${dateFormat} ${timePart}` : dateFormat
    dateTimeFormatSource = dateFormatSource
  }
  const [timeZone, timeZoneSource] = pick<'timeZone'>([
    ['user', canonicalizeTimeZone(userTimeZone)],
    ['tenant', canonicalizeTimeZone(stored.timeZone)],
    ['env', defaults.timeZone],
  ])
  const storedFirstDay: FirstDayOfWeek | null = isFirstDayOfWeek(stored.firstDayOfWeek) ? stored.firstDayOfWeek : null
  const [firstDayOfWeek, firstDayOfWeekSource] = pick<'firstDayOfWeek'>([
    ['tenant', storedFirstDay],
    ['env', defaults.firstDayOfWeek],
  ])

  return {
    locale,
    dateFormat,
    dateTimeFormat,
    timeFormat,
    timeZone,
    firstDayOfWeek,
    sources: {
      locale: localeSource,
      dateFormat: dateFormatSource,
      dateTimeFormat: dateTimeFormatSource,
      timeFormat: timeFormatSource,
      timeZone: timeZoneSource,
      firstDayOfWeek: firstDayOfWeekSource,
    },
  }
}

/** Settings with every field unset: what a page renders before (or without) a resolved value. */
export function emptyDateLocaleSettings(): ResolvedDateLocaleSettings {
  return resolveDateLocaleSettings({ env: { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null } })
}
