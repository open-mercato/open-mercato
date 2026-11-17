"use client"

import * as React from 'react'
import type { FirstDayOfWeek, ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { resolveFirstDayOfWeek } from '@open-mercato/shared/lib/date-locale/weekStart'
import {
  clearRenderingDateLocaleProvider,
  getActiveDateLocaleSettings,
  noteRenderingDateLocaleProvider,
  registerDateLocaleProvider,
  unregisterDateLocaleProvider,
} from './date-locale-store'

const DateLocaleSettingsContext = React.createContext<ResolvedDateLocaleSettings | null>(null)
const DateLocaleProviderDepthContext = React.createContext(-1)

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/**
 * Carries the tenant/user date and locale settings resolved on the server (see
 * `resolveDateLocaleSettingsForRequest`). The root layout mounts one for every page; the backend
 * and portal layouts mount a nested one, because the root layout is not re-rendered by a
 * client-side navigation (a login redirect would otherwise keep the anonymous defaults).
 */
export function DateLocaleSettingsProvider({
  value,
  children,
}: {
  value: ResolvedDateLocaleSettings | null | undefined
  children: React.ReactNode
}) {
  const settings = value ?? null
  const depth = React.useContext(DateLocaleProviderDepthContext) + 1
  const [key] = React.useState(() => ({}))
  // During render, not only in an effect: the first client render (hydration) must already format
  // with the tenant settings, otherwise every date cell renders once in the env default and flips.
  // The store resolves the innermost provider, so a root re-render cannot override a nested
  // layout's settings. The note lasts until the next commit: a render React throws away (an
  // interrupted transition, an error boundary) would otherwise keep its settings in the store.
  noteRenderingDateLocaleProvider(key, depth, settings)
  useIsomorphicLayoutEffect(() => {
    registerDateLocaleProvider(key, depth, settings)
  }, [key, depth, settings])
  useIsomorphicLayoutEffect(() => {
    clearRenderingDateLocaleProvider()
  })
  useIsomorphicLayoutEffect(() => () => unregisterDateLocaleProvider(key), [key])
  return (
    <DateLocaleProviderDepthContext.Provider value={depth}>
      <DateLocaleSettingsContext.Provider value={settings}>{children}</DateLocaleSettingsContext.Provider>
    </DateLocaleProviderDepthContext.Provider>
  )
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
 * The first day of the week: the configured day, otherwise the configured formatting locale's own
 * week start (`en-GB` Monday, `en-US` Sunday), otherwise Monday. Pass the result as `weekStartsOn`
 * to date-fns and `react-day-picker`.
 */
export function resolveWeekStartsOn(
  settings: Pick<ResolvedDateLocaleSettings, 'firstDayOfWeek' | 'locale'> = getActiveDateLocaleSettings(),
): FirstDayOfWeek {
  return resolveFirstDayOfWeek(settings).day
}

export function useWeekStartsOn(): FirstDayOfWeek {
  return resolveWeekStartsOn(useDateLocaleSettings())
}
