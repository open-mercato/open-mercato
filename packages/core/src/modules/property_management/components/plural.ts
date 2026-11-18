import * as React from 'react'
import { useLocale, useT, type TranslateFn, type TranslateParams } from '@open-mercato/shared/lib/i18n/context'

export type PluralFn = (key: string, fallback: string, count: number, params?: TranslateParams) => string

export type CountNoun = 'units' | 'spaces' | 'floors' | 'commonAreas'

const COUNT_FALLBACKS: Record<CountNoun, string> = {
  units: '{count} units',
  spaces: '{count} spaces',
  floors: '{count} floors',
  commonAreas: '{count} common areas',
}

export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(count)
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

export function translatePlural(
  t: TranslateFn,
  locale: string,
  key: string,
  fallback: string,
  count: number,
  params?: TranslateParams,
): string {
  const values = { ...params, count }
  const categoryKey = `${key}.${pluralCategory(locale, count)}`
  const resolved = t(categoryKey, values)
  if (resolved !== categoryKey) return resolved
  return t(`${key}.other`, fallback, values)
}

export function translateCount(t: TranslateFn, locale: string, noun: CountNoun, count: number): string {
  return translatePlural(t, locale, `property_management.counts.${noun}`, COUNT_FALLBACKS[noun], count)
}

export type PluralHelpers = { plural: PluralFn; count: (noun: CountNoun, value: number) => string }

export function usePlural(): PluralHelpers {
  const t = useT()
  const locale = useLocale()
  return React.useMemo(
    () => ({
      plural: (key, fallback, value, params) => translatePlural(t, locale, key, fallback, value, params),
      count: (noun, value) => translateCount(t, locale, noun, value),
    }),
    [locale, t],
  )
}
