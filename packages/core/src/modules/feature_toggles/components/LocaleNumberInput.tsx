"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatLocaleNumberInput, parseLocaleNumber } from '@open-mercato/shared/lib/number'

type LocaleNumberInputProps = {
  value: unknown
  onValueChange: (value: number) => void
  disabled?: boolean
  autoFocus?: boolean
}

function toDisplayedNumber(value: unknown): number {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : 0
}

/**
 * A controlled `type="number"` input drops a decimal comma the moment the field re-renders from
 * form state, so `12,5` typed under Polish became `125`. Typed text is kept locally while focused
 * and parsed with the locale's separators; unparseable text stores 0, as the previous field did.
 */
export function LocaleNumberInput({ value, onValueChange, disabled, autoFocus }: LocaleNumberInputProps) {
  const locale = useOptionalLocale()
  const numericValue = toDisplayedNumber(value)
  const formatted = formatLocaleNumberInput(numericValue, locale)
  const [text, setText] = React.useState<string>(formatted)
  const isFocusedRef = React.useRef(false)

  React.useEffect(() => {
    if (!isFocusedRef.current) setText(formatted)
  }, [formatted])

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => {
        isFocusedRef.current = true
      }}
      onBlur={() => {
        isFocusedRef.current = false
        setText(formatted)
      }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        onValueChange(parseLocaleNumber(next, locale) ?? 0)
      }}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}
