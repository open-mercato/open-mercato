"use client"

import * as React from 'react'
import type { VariantProps } from 'class-variance-authority'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { inputWrapperVariants, inputElementVariants } from './input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemLeading,
  SelectTrigger,
} from './select'

export type AmountCurrency = {
  /** ISO 4217 code (e.g. `'EUR'`, `'USD'`, `'PLN'`). */
  code: string
  /** Symbol shown as the leading prefix inside the amount input (e.g. `'€'`). */
  symbol: string
  /** Human-readable label for the picker dropdown. */
  label: string
  /** Optional emoji flag (or any leading visual) for the picker row. */
  flag?: string
}

/**
 * Static currency list — extend as needed. Order is alphabetical by code so the picker reads
 * predictably; the first entry is the default fallback when `value.currency` is empty or
 * unrecognised.
 */
export const AMOUNT_CURRENCIES: AmountCurrency[] = [
  { code: 'EUR', symbol: '€', label: 'Euro', flag: '🇪🇺' },
  { code: 'USD', symbol: '$', label: 'US Dollar', flag: '🇺🇸' },
  { code: 'GBP', symbol: '£', label: 'Pound Sterling', flag: '🇬🇧' },
  { code: 'PLN', symbol: 'zł', label: 'Polish Złoty', flag: '🇵🇱' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'SEK', symbol: 'kr', label: 'Swedish Krona', flag: '🇸🇪' },
  { code: 'CZK', symbol: 'Kč', label: 'Czech Koruna', flag: '🇨🇿' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar', flag: '🇨🇦' },
]

const DEFAULT_CURRENCY = AMOUNT_CURRENCIES[0]

export type AmountValue = {
  /** Raw numeric amount as a string (preserves leading zeros, partial decimals like `'12.'`). */
  amount: string
  /** ISO 4217 currency code from the picker. */
  currency: string
}

export type AmountInputProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'size' | 'type' | 'value' | 'onChange'
> &
  VariantProps<typeof inputWrapperVariants> & {
    value: AmountValue
    onChange: (next: AmountValue) => void
    /** Override the static currency list (e.g. limit to specific markets). */
    currencies?: AmountCurrency[]
    /** Hide the currency picker entirely — single-currency surfaces (e.g. settings page). */
    showCurrency?: boolean
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
  }

function findCurrency(code: string, list: AmountCurrency[]): AmountCurrency {
  return list.find((c) => c.code === code) ?? list[0] ?? DEFAULT_CURRENCY
}

/**
 * Amount input matching Figma `Text Input [1.1]` (node `266:5251`) **Amount** variant — leading
 * currency symbol inside the input, then a vertical divider, then a `Select`-driven currency
 * picker (flag + code + chevron). Numeric `inputMode="decimal"`.
 *
 * Value shape is `{ amount: string, currency: string }` — the amount is stored as a string to
 * preserve raw user input (leading zeros, in-progress decimals). Parse to `Number` at the
 * API/persistence boundary.
 */
export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  (
    {
      className,
      inputClassName,
      size,
      value,
      onChange,
      currencies: currenciesProp,
      showCurrency = true,
      placeholder,
      disabled,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const resolvedPlaceholder = placeholder ?? t('ui.inputs.amountInput.placeholder', '0.00')
    const currencies = currenciesProp ?? AMOUNT_CURRENCIES
    const current = findCurrency(value.currency, currencies)

    const handleAmountChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        onChange({ amount: event.target.value, currency: current.code })
      },
      [current.code, onChange],
    )

    const handleCurrencyChange = React.useCallback(
      (nextCode: string) => {
        onChange({ amount: value.amount, currency: nextCode })
      },
      [onChange, value.amount],
    )

    return (
      <div
        className={cn(inputWrapperVariants({ size }), 'px-0 overflow-hidden', className)}
        data-slot="amount-input-wrapper"
      >
        <div className="flex flex-1 min-w-0 items-center gap-2 pl-3">
          <span
            className="text-sm text-muted-foreground select-none shrink-0 tabular-nums"
            aria-hidden="true"
          >
            {current.symbol}
          </span>
          <input
            ref={ref}
            type="text"
            inputMode="decimal"
            value={value.amount}
            onChange={handleAmountChange}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            className={cn(
              inputElementVariants({ size }),
              'pr-3 tabular-nums',
              inputClassName,
            )}
            {...props}
          />
        </div>
        {showCurrency ? (
          <>
            <div aria-hidden="true" className="w-px self-stretch bg-input" />
            <Select value={current.code} onValueChange={handleCurrencyChange} disabled={disabled}>
              <SelectTrigger
                aria-label={t('ui.inputs.amountInput.currencyLabel', 'Currency')}
                className={cn(
                  'h-auto w-auto shrink-0 gap-1.5 rounded-none border-0 bg-transparent px-2.5 py-2 shadow-none',
                  'hover:bg-muted/40 focus:bg-muted/40 focus-visible:shadow-none focus-visible:border-0',
                  'disabled:bg-transparent disabled:hover:bg-transparent',
                )}
              >
                {current.flag ? (
                  <span className="text-base leading-none" aria-hidden="true">{current.flag}</span>
                ) : null}
                <span className="text-sm text-foreground tabular-nums">{current.code}</span>
              </SelectTrigger>
              <SelectContent align="end">
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.flag ? (
                      <SelectItemLeading>
                        <span className="text-base leading-none">{c.flag}</span>
                      </SelectItemLeading>
                    ) : null}
                    <span className="flex-1 truncate">{c.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">{c.code}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>
    )
  },
)
AmountInput.displayName = 'AmountInput'
