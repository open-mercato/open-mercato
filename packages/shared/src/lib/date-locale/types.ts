export const DATE_LOCALE_FIELDS = [
  'locale',
  'dateFormat',
  'dateTimeFormat',
  'timeFormat',
  'timeZone',
  'firstDayOfWeek',
] as const

export type DateLocaleField = (typeof DATE_LOCALE_FIELDS)[number]

/** 0 = Sunday … 6 = Saturday, matching `date-fns` `weekStartsOn`. */
export type FirstDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Stored tenant settings. Every field is optional: an absent field inherits the env default,
 * then the locale/system fallback. Patterns are `date-fns` format strings.
 */
export type DateLocaleSettingsInput = {
  locale?: string | null
  dateFormat?: string | null
  dateTimeFormat?: string | null
  timeFormat?: string | null
  timeZone?: string | null
  firstDayOfWeek?: FirstDayOfWeek | null
}

/** A stored tenant blob after validation: every field present, `null` meaning "inherit". */
export type NormalizedDateLocaleSettingsRecord = {
  locale: string | null
  dateFormat: string | null
  dateTimeFormat: string | null
  timeFormat: string | null
  timeZone: string | null
  firstDayOfWeek: FirstDayOfWeek | null
}

export type DateLocaleSource = 'user' | 'tenant' | 'env' | 'fallback'

/**
 * Effective settings. `null` means "derive from the locale at render time":
 * - `locale`: the active i18n locale formats dates
 * - `dateFormat` / `dateTimeFormat` / `timeFormat`: `Intl` renders the locale's own style
 * - `timeZone`: the viewer's runtime zone (browser or server process)
 * - `firstDayOfWeek`: the locale's week start
 */
export type ResolvedDateLocaleSettings = {
  locale: string | null
  dateFormat: string | null
  dateTimeFormat: string | null
  timeFormat: string | null
  timeZone: string | null
  firstDayOfWeek: FirstDayOfWeek | null
  sources: Record<DateLocaleField, DateLocaleSource>
}

/** DI key under which the `auth` module registers `UserTimeZoneLookup`. */
export const USER_TIME_ZONE_LOOKUP_DI_KEY = 'userTimeZoneLookup'

/** The user's personal timezone, or `null` when they follow the organization default. */
export type UserTimeZoneLookup = (input: { userId: string; tenantId: string }) => Promise<string | null>

/** Bootstrap defaults read from the environment (see `readDateLocaleEnv`). */
export type DateLocaleEnvDefaults = Omit<ResolvedDateLocaleSettings, 'sources'>
