"use client"

import * as React from 'react'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  ISO_COUNTRIES,
  buildCountryOptions,
  resolveCountryName,
} from '@open-mercato/shared/lib/location/countries'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'

export type CountrySelectFieldProps = {
  id: string
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  placeholder?: string
}

function formatCountryLabel(code: string, name: string): string {
  return `${name} (${code})`
}

function normalizeCountryCode(value: string): string {
  return value.trim().toUpperCase()
}

export function CountrySelectField({
  id,
  value,
  onChange,
  disabled,
  placeholder,
}: CountrySelectFieldProps) {
  const locale = useLocale()
  const options = React.useMemo<ComboboxOption[]>(() => {
    return buildCountryOptions({
      locale,
      transformLabel: formatCountryLabel,
    }).map((option) => ({
      value: option.code,
      label: option.label,
    }))
  }, [locale])

  const knownCodes = React.useMemo(() => new Set(ISO_COUNTRIES.map((country) => country.code)), [])
  const selectedValue = typeof value === 'string' ? normalizeCountryCode(value) : ''

  const resolveLabel = React.useCallback((code: string) => {
    const normalized = normalizeCountryCode(code)
    const localizedName = knownCodes.has(normalized)
      ? resolveCountryName(normalized, { locale })
      : normalized
    return formatCountryLabel(normalized, localizedName)
  }, [knownCodes, locale])

  return (
    <div id={id}>
    <ComboboxInput
      value={selectedValue}
      onChange={(nextValue) => {
        const normalized = normalizeCountryCode(nextValue)
        onChange(normalized.length > 0 ? normalized : null)
      }}
      suggestions={options}
      seedOptions={selectedValue ? [{ value: selectedValue, label: resolveLabel(selectedValue) }] : undefined}
      resolveLabel={resolveLabel}
      placeholder={placeholder}
      disabled={disabled}
      allowCustomValues={false}
      clearable
    />
    </div>
  )
}

export default CountrySelectField
