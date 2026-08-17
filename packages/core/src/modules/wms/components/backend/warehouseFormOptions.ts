import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { buildCountryOptions, resolveCountryName } from '@open-mercato/shared/lib/location/countries'

const OPTION_LIMIT = 100

function matchesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase())
}

export function countryOptionFromStored(value: string, locale?: string): CrudFieldOption {
  const trimmed = value.trim()
  const code = trimmed.toUpperCase()
  const label = resolveCountryName(code, { locale })
  if (label && label !== code) {
    return { value: code, label }
  }
  return { value: trimmed, label: trimmed }
}

export function timezoneOptionFromStored(value: string): CrudFieldOption {
  const trimmed = value.trim()
  return { value: trimmed, label: trimmed }
}

export async function loadCountryOptions(query?: string, locale?: string): Promise<CrudFieldOption[]> {
  const options = buildCountryOptions({ locale }).map((entry) => ({
    value: entry.code,
    label: entry.label,
  }))
  const term = query?.trim()
  const filtered = term
    ? options.filter((option) => matchesQuery(option.label, term) || matchesQuery(option.value, term))
    : options
  return filtered.slice(0, OPTION_LIMIT)
}

export async function loadTimezoneOptions(query?: string): Promise<CrudFieldOption[]> {
  try {
    const allTz = Array.from(new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]))
    const term = query?.trim()
    const filtered = term
      ? allTz.filter((tz) => matchesQuery(tz, term))
      : allTz
    return filtered.slice(0, OPTION_LIMIT).map((tz) => ({ value: tz, label: tz }))
  } catch {
    return [{ value: 'UTC', label: 'UTC' }]
  }
}
