"use client"

import * as React from 'react'
import type { FirstDayOfWeek, ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import { getActiveDateLocaleSettings, setClientDateLocaleSettings } from './date-locale-store'
import { resolveDateFnsLocale } from './date-locale'

const DateLocaleSettingsContext = React.createContext<ResolvedDateLocaleSettings | null>(null)

/**
 * Carries the tenant/user date and locale settings resolved on the server (see
 * `resolveDateLocaleSettingsForRequest`). Mounted next to `I18nProvider` in the app layouts.
 */
export function DateLocaleSettingsProvider({
  value,
  children,
}: {
  value: ResolvedDateLocaleSettings | null | undefined
  children: React.ReactNode
}) {
  const settings = value ?? null
  // Synchronous, not an effect: the first client render (hydration) must already format with the
  // tenant settings, otherwise every date cell renders once in the env default and then flips.
  setClientDateLocaleSettings(settings)
  return <DateLocaleSettingsContext.Provider value={settings}>{children}</DateLocaleSettingsContext.Provider>
}

/** The active settings; env defaults outside a provider. */
export function useDateLocaleSettings(): ResolvedDateLocaleSettings {
  const settings = React.useContext(DateLocaleSettingsContext)
  return settings ?? getActiveDateLocaleSettings()
}

/** The IANA zone dates should render in; the viewer's runtime zone when nothing is configured. */
export function resolveDisplayTimeZone(settings: Pick<ResolvedDateLocaleSettings, 'timeZone'> = getActiveDateLocaleSettings()): string {
  if (settings.timeZone) return settings.timeZone
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function useDisplayTimeZone(): string {
  return resolveDisplayTimeZone(useDateLocaleSettings())
}

/**
 * The configured first day of the week, otherwise the locale's own (`pl`/`de`/`es` Monday,
 * `en`/`ko` Sunday). Pass the result as `weekStartsOn` to date-fns and `react-day-picker`.
 */
export function resolveWeekStartsOn(
  locale: string | null | undefined,
  settings: Pick<ResolvedDateLocaleSettings, 'firstDayOfWeek' | 'locale'> = getActiveDateLocaleSettings(),
): FirstDayOfWeek {
  if (settings.firstDayOfWeek !== null) return settings.firstDayOfWeek
  const fromLocale = resolveDateFnsLocale(settings.locale ?? locale)?.options?.weekStartsOn
  return (typeof fromLocale === 'number' ? fromLocale : 0) as FirstDayOfWeek
}

export function useWeekStartsOn(): FirstDayOfWeek {
  return resolveWeekStartsOn(useOptionalLocale(), useDateLocaleSettings())
}
