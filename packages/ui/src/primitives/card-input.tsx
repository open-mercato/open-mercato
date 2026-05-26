"use client"

import * as React from 'react'
import { CreditCard } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { inputWrapperVariants, inputElementVariants } from './input'

export type CardBrand = {
  /** Stable identifier (e.g. `'visa'`, `'mastercard'`). Used as the `data-card-brand` attribute. */
  id: string
  /** Short label rendered on the trailing badge (e.g. `'VISA'`, `'MC'`). */
  label: string
  /** Regex pattern matched against the digits-only card number. */
  regex: RegExp
  /** Grouping for display (e.g. `[4, 4, 4, 4]` for Visa, `[4, 6, 5]` for Amex). */
  format: number[]
  /** Maximum number of digits allowed (Visa/MC/Disc 16, Amex 15, Diners 14). */
  maxLength: number
  /** Background color for the brand badge. */
  bg: string
  /** Foreground (text) color for the brand badge label. Defaults to white. */
  fg?: string
}

/**
 * Default card brand list — covers the most common networks. Order matters: the first matching
 * regex wins, so brands with broader prefixes (e.g. UnionPay `^62`) MUST come after narrower ones
 * (e.g. Discover `^622`). Override with the `brands` prop for region-specific surfaces.
 */
export const CARD_BRANDS: CardBrand[] = [
  { id: 'amex', label: 'AMEX', regex: /^3[47]/, format: [4, 6, 5], maxLength: 15, bg: '#006FCF' },
  { id: 'visa', label: 'VISA', regex: /^4/, format: [4, 4, 4, 4], maxLength: 16, bg: '#1A1F71' },
  { id: 'mastercard', label: 'MC', regex: /^(5[1-5]|2[2-7])/, format: [4, 4, 4, 4], maxLength: 16, bg: '#EB001B' },
  { id: 'discover', label: 'DISC', regex: /^(6011|64[4-9]|65|622)/, format: [4, 4, 4, 4], maxLength: 16, bg: '#FF6000' },
  { id: 'diners', label: 'DC', regex: /^(36|30[0-5]|309)/, format: [4, 6, 4], maxLength: 14, bg: '#0079BE' },
  { id: 'jcb', label: 'JCB', regex: /^35(2[89]|[3-8])/, format: [4, 4, 4, 4], maxLength: 16, bg: '#0E4C96' },
  { id: 'unionpay', label: 'UP', regex: /^62/, format: [4, 4, 4, 4], maxLength: 16, bg: '#E21836' },
]

const DEFAULT_FORMAT: number[] = [4, 4, 4, 4]
const DEFAULT_MAX_LENGTH = 16

function detectBrand(digits: string, brands: CardBrand[]): CardBrand | null {
  if (!digits) return null
  for (const brand of brands) {
    if (brand.regex.test(digits)) return brand
  }
  return null
}

function formatDigits(digits: string, format: number[]): string {
  if (!digits) return ''
  const groups: string[] = []
  let cursor = 0
  for (const groupSize of format) {
    if (cursor >= digits.length) break
    groups.push(digits.slice(cursor, cursor + groupSize))
    cursor += groupSize
  }
  if (cursor < digits.length) groups.push(digits.slice(cursor))
  return groups.join(' ')
}

function sanitize(input: string, maxLength: number): string {
  return input.replace(/\D+/g, '').slice(0, maxLength)
}

export type CardInputProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'size' | 'type' | 'value' | 'onChange'
> &
  VariantProps<typeof inputWrapperVariants> & {
    /** Controlled value — digits-only (no spaces). Pass formatted strings if you must; non-digits are stripped. */
    value: string
    /** Called with the new digits-only string. The component handles formatting on display. */
    onChange: (digits: string) => void
    /** Called when the detected brand changes. `null` when nothing matches yet. */
    onBrandChange?: (brand: CardBrand | null) => void
    /** Override the card brand list (e.g. region-specific). */
    brands?: CardBrand[]
    /** Render the leading bank-card icon. Defaults to `true`. */
    showLeadingIcon?: boolean
    /** Render the trailing brand badge. Defaults to `true`. */
    showBrandBadge?: boolean
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
  }

/**
 * Card-number input matching Figma `Text Input [1.1]` (node `266:5251`) **Card** variant — leading
 * `CreditCard` icon, the formatted card-number input, and a trailing brand badge that auto-detects
 * the issuer (Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay) from the typed digits.
 *
 * Built on the shared `inputWrapperVariants` / `inputElementVariants` CVA. Brand detection is
 * regex-based — no external library dependency. The `value` prop is digits-only; the component
 * formats per brand on display (`[4,4,4,4]` default, `[4,6,5]` Amex, `[4,6,4]` Diners) and emits
 * digits-only via `onChange`.
 */
export const CardInput = React.forwardRef<HTMLInputElement, CardInputProps>(
  (
    {
      className,
      inputClassName,
      size,
      value,
      onChange,
      onBrandChange,
      brands: brandsProp,
      showLeadingIcon = true,
      showBrandBadge = true,
      placeholder,
      disabled,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const brands = brandsProp ?? CARD_BRANDS
    const sanitizedValue = sanitize(value ?? '', DEFAULT_MAX_LENGTH)
    const detected = detectBrand(sanitizedValue, brands)
    const format = detected?.format ?? DEFAULT_FORMAT
    const maxLength = detected?.maxLength ?? DEFAULT_MAX_LENGTH
    const truncated = sanitizedValue.slice(0, maxLength)
    const displayed = formatDigits(truncated, format)
    const resolvedPlaceholder = placeholder ?? t('ui.inputs.cardInput.placeholder', '0000 0000 0000 0000')

    const lastBrandRef = React.useRef<string | null>(null)
    React.useEffect(() => {
      const next = detected?.id ?? null
      if (next !== lastBrandRef.current) {
        lastBrandRef.current = next
        onBrandChange?.(detected)
      }
    }, [detected, onBrandChange])

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextBrand = detectBrand(sanitize(event.target.value, DEFAULT_MAX_LENGTH), brands)
        const nextMax = nextBrand?.maxLength ?? DEFAULT_MAX_LENGTH
        const digits = sanitize(event.target.value, nextMax)
        onChange(digits)
      },
      [brands, onChange],
    )

    return (
      <div
        className={cn(inputWrapperVariants({ size }), className)}
        data-slot="card-input-wrapper"
        data-card-brand={detected?.id ?? 'unknown'}
      >
        {showLeadingIcon ? (
          <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="cc-number"
          value={displayed}
          onChange={handleChange}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          className={cn(
            inputElementVariants({ size }),
            'tracking-[0.02em] tabular-nums',
            inputClassName,
          )}
          {...props}
        />
        {showBrandBadge && detected ? (
          <span
            className="flex shrink-0 items-center justify-center rounded-sm px-1.5 text-overline font-semibold uppercase tracking-wider tabular-nums leading-none select-none"
            style={{
              backgroundColor: detected.bg,
              color: detected.fg ?? '#ffffff',
              height: '24px',
              minWidth: '32px',
            }}
            aria-hidden="true"
          >
            {detected.label}
          </span>
        ) : null}
      </div>
    )
  },
)
CardInput.displayName = 'CardInput'
