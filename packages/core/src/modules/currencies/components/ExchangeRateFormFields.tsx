"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Input } from '@open-mercato/ui/primitives/input'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatLocaleDecimalInput, parseLocaleDecimal } from '@open-mercato/shared/lib/number'
import { isDecimalInput } from '@open-mercato/shared/lib/decimal'

function currencyCode(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : '—'
}

function rateText(value: unknown, locale: string): string {
  if (typeof value === 'string' && isDecimalInput(value)) return formatLocaleDecimalInput(value, locale)
  if (typeof value === 'number' && isDecimalInput(value)) return formatLocaleDecimalInput(value, locale)
  return typeof value === 'string' ? value : ''
}

export function ExchangeRateInput({ id, value, values, setValue, label }: CrudCustomFieldRenderProps & { label: string }) {
  const locale = useLocale()
  const [text, setText] = React.useState(() => rateText(value, locale))

  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-sm text-muted-foreground">1 {currencyCode(values?.fromCurrencyCode)} =</span>
      <Input
        id={id}
        aria-label={label}
        type="text"
        inputMode="decimal"
        placeholder="1.0"
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          setValue(parseLocaleDecimal(next, locale) ?? next)
        }}
      />
      <span className="whitespace-nowrap text-sm text-muted-foreground">{currencyCode(values?.toCurrencyCode)}</span>
    </div>
  )
}

function metadataValueText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function ExchangeRateMetadataList({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {Object.entries(metadata).map(([key, value]) => (
        <React.Fragment key={key}>
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-all text-foreground">{metadataValueText(value)}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}
