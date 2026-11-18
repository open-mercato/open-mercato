import * as React from 'react'
import type { Locale } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import { useDateFnsLocale } from '@open-mercato/ui/primitives/date-locale'

export function withMondayWeekStart(base: Locale): Locale {
  return { ...base, options: { ...base.options, weekStartsOn: 1 } }
}

export function useMondayDateLocale(): Locale {
  const base = useDateFnsLocale() ?? enUS
  return React.useMemo(() => withMondayWeekStart(base), [base])
}
