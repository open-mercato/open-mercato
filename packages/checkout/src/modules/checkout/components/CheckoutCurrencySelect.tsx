"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type CurrencyDictionaryPayload = {
  entries?: Array<{
    value?: string | null
    label?: string | null
  }>
}

type Props = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}

function normalizeCurrencyOptions(payload: CurrencyDictionaryPayload | null): ComboboxOption[] {
  const items = Array.isArray(payload?.entries) ? payload.entries : []
  return items.reduce<ComboboxOption[]>((result, entry) => {
    const value = typeof entry?.value === 'string' ? entry.value.trim().toUpperCase() : ''
    if (!value) return result
    const label = typeof entry?.label === 'string' && entry.label.trim().length > 0
      ? entry.label.trim()
      : value
    result.push({
      value,
      label: `${value} · ${label}`,
      description: label,
    })
    return result
  }, [])
}

export function CheckoutCurrencySelect({ value, onChange, placeholder = 'Select currency' }: Props) {
  const t = useT()
  const [options, setOptions] = React.useState<ComboboxOption[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const loadOptions = React.useCallback(async () => {
    try {
      const payload = await readApiResultOrThrow<CurrencyDictionaryPayload>(
        '/api/customers/dictionaries/currency',
        undefined,
        { errorMessage: t('checkout.currencySelect.errors.load') },
      )
      setOptions(normalizeCurrencyOptions(payload))
      setError(null)
    } catch (loadError) {
      setOptions([])
      setError(loadError instanceof Error ? loadError.message : t('checkout.currencySelect.errors.load'))
    }
  }, [t])

  React.useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  return (
    <div className="space-y-1">
      <ComboboxInput
        value={value}
        onChange={(next) => onChange(next.trim().toUpperCase())}
        placeholder={placeholder || t('checkout.currencySelect.placeholder')}
        suggestions={options}
        loadSuggestions={async (query) => {
          const normalized = query?.trim().toLowerCase() ?? ''
          if (!normalized) return options
          return options.filter((option) => option.label.toLowerCase().includes(normalized))
        }}
        allowCustomValues={options.length === 0}
      />
      {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
    </div>
  )
}

export default CheckoutCurrencySelect
