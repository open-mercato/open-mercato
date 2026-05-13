"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractPhoneDigits, validatePhoneNumber } from '@open-mercato/shared/lib/phone'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemLeading,
  SelectTrigger,
} from '../../primitives/select'

export type PhoneDuplicateMatch = {
  id: string
  label: string
  href: string
}

export type PhoneCountry = {
  /** ISO 3166-1 alpha-2 code. */
  iso2: string
  /** International dial code (with `+`). */
  dialCode: string
  /** Human-readable country name (English). Override per surface for i18n. */
  label: string
  /** Emoji flag (no asset dependency). */
  flag: string
}

/**
 * Static country list — focused on EU + Americas markets where Open Mercato
 * currently operates. Extend as needed; longest dial codes MUST appear before
 * their shorter ancestors (e.g. `+380` before `+38`) to keep prefix matching
 * deterministic. The default fallback is the first entry.
 */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso2: 'US', dialCode: '+1', label: 'United States', flag: '🇺🇸' },
  { iso2: 'CA', dialCode: '+1', label: 'Canada', flag: '🇨🇦' },
  { iso2: 'GB', dialCode: '+44', label: 'United Kingdom', flag: '🇬🇧' },
  { iso2: 'PL', dialCode: '+48', label: 'Poland', flag: '🇵🇱' },
  { iso2: 'DE', dialCode: '+49', label: 'Germany', flag: '🇩🇪' },
  { iso2: 'FR', dialCode: '+33', label: 'France', flag: '🇫🇷' },
  { iso2: 'ES', dialCode: '+34', label: 'Spain', flag: '🇪🇸' },
  { iso2: 'IT', dialCode: '+39', label: 'Italy', flag: '🇮🇹' },
  { iso2: 'NL', dialCode: '+31', label: 'Netherlands', flag: '🇳🇱' },
  { iso2: 'SE', dialCode: '+46', label: 'Sweden', flag: '🇸🇪' },
  { iso2: 'AT', dialCode: '+43', label: 'Austria', flag: '🇦🇹' },
  { iso2: 'CH', dialCode: '+41', label: 'Switzerland', flag: '🇨🇭' },
  { iso2: 'PT', dialCode: '+351', label: 'Portugal', flag: '🇵🇹' },
  { iso2: 'CZ', dialCode: '+420', label: 'Czechia', flag: '🇨🇿' },
  { iso2: 'RO', dialCode: '+40', label: 'Romania', flag: '🇷🇴' },
  { iso2: 'UA', dialCode: '+380', label: 'Ukraine', flag: '🇺🇦' },
]

const DEFAULT_COUNTRY = PHONE_COUNTRIES[0]
// Match longer prefixes first to avoid e.g. `+1` shadowing `+1234` if any.
const COUNTRIES_BY_DIAL_LENGTH = [...PHONE_COUNTRIES].sort(
  (a, b) => b.dialCode.length - a.dialCode.length,
)

function findCountryByIso(iso2: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.iso2 === iso2)
}

function parseCountryFromValue(value: string | null | undefined): PhoneCountry | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('+')) return null
  for (const country of COUNTRIES_BY_DIAL_LENGTH) {
    if (trimmed.startsWith(country.dialCode)) return country
  }
  return null
}

function extractLocalNumber(value: string | null | undefined, dialCode: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed.startsWith(dialCode)) return trimmed
  return trimmed.slice(dialCode.length).trim()
}

function composeValue(country: PhoneCountry, localNumber: string): string {
  const trimmed = localNumber.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) return trimmed
  return `${country.dialCode} ${trimmed}`
}

export type PhoneNumberFieldProps = {
  id?: string
  value?: string | null
  onValueChange: (next: string | undefined) => void
  onDigitsChange?: (digits: string | null) => void
  externalError?: string | null
  disabled?: boolean
  autoFocus?: boolean
  ariaLabel?: string
  ariaDescribedBy?: string
  placeholder?: string
  minDigits?: number
  checkingLabel?: string
  duplicateLabel?: (match: PhoneDuplicateMatch) => string
  duplicateLinkLabel?: string
  invalidLabel?: string
  onDuplicateLookup?: (normalizedValue: string) => Promise<PhoneDuplicateMatch | null>
  /** Override the static country list (e.g. limit to specific markets). */
  countries?: PhoneCountry[]
  /** Initial country shown when `value` is empty / unparseable. Defaults to US. */
  defaultCountryIso2?: string
}

const DEFAULT_MIN_DIGITS = 6
const DEFAULT_PLACEHOLDER = '(555) 000-0000'

export function PhoneNumberField({
  id,
  value,
  onValueChange,
  onDigitsChange,
  externalError,
  disabled = false,
  autoFocus,
  ariaLabel,
  ariaDescribedBy,
  placeholder,
  minDigits = DEFAULT_MIN_DIGITS,
  checkingLabel,
  duplicateLabel,
  duplicateLinkLabel,
  invalidLabel,
  onDuplicateLookup,
  countries: countriesProp,
  defaultCountryIso2,
}: PhoneNumberFieldProps) {
  const t = useT()
  const resolvedInvalidLabel = invalidLabel ?? t(
    'ui.inputs.phoneNumberField.invalid',
    'Enter a valid phone number with country code (e.g. +1 212 555 1234)'
  )
  const resolvedCheckingLabel = checkingLabel ?? t(
    'ui.inputs.phoneNumberField.checking',
    'Checking for duplicates…'
  )
  const resolvedDuplicateLinkLabel = duplicateLinkLabel ?? t(
    'ui.inputs.phoneNumberField.duplicateLink',
    'Open record'
  )
  const resolvedPlaceholder = placeholder ?? DEFAULT_PLACEHOLDER
  const countries = countriesProp ?? PHONE_COUNTRIES
  const fallbackCountry = React.useMemo(
    () => (defaultCountryIso2 && findCountryByIso(defaultCountryIso2)) || DEFAULT_COUNTRY,
    [defaultCountryIso2],
  )

  const initialCountry = React.useMemo(
    () => parseCountryFromValue(value) ?? fallbackCountry,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [country, setCountry] = React.useState<PhoneCountry>(initialCountry)
  const [localNumber, setLocalNumber] = React.useState<string>(() =>
    extractLocalNumber(value, initialCountry.dialCode),
  )
  const [duplicate, setDuplicate] = React.useState<PhoneDuplicateMatch | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [validationHint, setValidationHint] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState(false)
  const userEditingRef = React.useRef(false)

  const externalFieldError = externalError && externalError.trim().length > 0 ? externalError : null
  const errorMessage = externalFieldError ?? validationHint
  const errorId = errorMessage && id ? `${id}-error` : undefined
  const describedBy = [ariaDescribedBy, errorId].filter((part): part is string => Boolean(part)).join(' ') || undefined
  const composedValue = composeValue(country, localNumber)

  // Sync local state when `value` updates externally and the user is not editing.
  React.useEffect(() => {
    if (userEditingRef.current) return
    if (value == null || value === '') {
      setLocalNumber('')
      onDigitsChange?.(null)
      return
    }
    const parsed = parseCountryFromValue(value)
    if (parsed) setCountry(parsed)
    const next = extractLocalNumber(value, parsed?.dialCode ?? country.dialCode)
    setLocalNumber(next)
    onDigitsChange?.(extractPhoneDigits(String(value)) || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Debounced duplicate lookup.
  React.useEffect(() => {
    if (!onDuplicateLookup || disabled) {
      setDuplicate(null)
      setChecking(false)
      return
    }
    const digits = extractPhoneDigits(composedValue)
    if (!digits || digits.length < minDigits) {
      setDuplicate(null)
      setChecking(false)
      return
    }

    let cancelled = false
    setChecking(true)
    const handle = window.setTimeout(async () => {
      try {
        const match = await onDuplicateLookup(digits)
        if (!cancelled) setDuplicate(match)
      } catch {
        if (!cancelled) setDuplicate(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [composedValue, disabled, minDigits, onDuplicateLookup])

  const emit = React.useCallback(
    (nextCountry: PhoneCountry, nextLocal: string) => {
      const composed = composeValue(nextCountry, nextLocal)
      onValueChange(composed.length ? composed : undefined)
      onDigitsChange?.(extractPhoneDigits(composed) || null)
    },
    [onDigitsChange, onValueChange],
  )

  const handleCountryChange = React.useCallback(
    (iso2: string) => {
      const next = findCountryByIso(iso2)
      if (!next) return
      userEditingRef.current = true
      setCountry(next)
      setValidationHint(null)
      emit(next, localNumber)
    },
    [emit, localNumber],
  )

  const handleLocalChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      userEditingRef.current = true
      setLocalNumber(next)
      setValidationHint(null)
      emit(country, next)
    },
    [country, emit],
  )

  const handleBlur = React.useCallback(() => {
    userEditingRef.current = false
    setFocused(false)
    const trimmed = localNumber.trim()
    if (!trimmed) {
      setLocalNumber('')
      setValidationHint(null)
      onValueChange(undefined)
      onDigitsChange?.(null)
      return
    }
    const composed = composeValue(country, trimmed)
    const result = validatePhoneNumber(composed)
    if (result.valid) {
      const normalizedLocal = extractLocalNumber(result.normalized ?? composed, country.dialCode)
      setLocalNumber(normalizedLocal)
      setValidationHint(null)
      onValueChange(result.normalized || undefined)
      onDigitsChange?.(result.digits || null)
    } else {
      setValidationHint(resolvedInvalidLabel)
      onValueChange(composed)
      onDigitsChange?.(result.digits || null)
    }
  }, [country, localNumber, onDigitsChange, onValueChange, resolvedInvalidLabel])

  const containerErrorBorder = errorMessage ? 'border-status-error-icon' : 'border-input'
  const containerFocusBorder = errorMessage
    ? 'border-status-error-icon shadow-focus'
    : 'border-brand-violet shadow-focus'

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex items-stretch w-full rounded-md border bg-background shadow-xs transition-colors',
          disabled
            ? 'bg-bg-disabled border-border-disabled cursor-not-allowed'
            : focused
              ? containerFocusBorder
              : `${containerErrorBorder} hover:border-foreground/30`,
        )}
        aria-invalid={errorMessage ? 'true' : undefined}
      >
        <Select value={country.iso2} onValueChange={handleCountryChange} disabled={disabled}>
          <SelectTrigger
            aria-label={ariaLabel ? `${ariaLabel} country` : 'Country code'}
            className={cn(
              'h-auto w-auto shrink-0 gap-1.5 rounded-none rounded-l-md border-0 bg-transparent px-2.5 py-2 shadow-none',
              'hover:bg-muted/40 focus:bg-muted/40 focus-visible:shadow-none focus-visible:border-0',
              'disabled:bg-transparent disabled:hover:bg-transparent',
            )}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            <span className="text-base leading-none" aria-hidden="true">{country.flag}</span>
            <span className="text-sm text-foreground tabular-nums">{country.dialCode}</span>
          </SelectTrigger>
          <SelectContent align="start">
            {countries.map((c) => (
              <SelectItem key={`${c.iso2}-${c.dialCode}`} value={c.iso2}>
                <SelectItemLeading>
                  <span className="text-base leading-none">{c.flag}</span>
                </SelectItemLeading>
                <span className="flex-1 truncate">{c.label}</span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">{c.dialCode}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div aria-hidden="true" className="w-px self-stretch bg-input" />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={localNumber}
          onChange={handleLocalChange}
          onBlur={handleBlur}
          onFocus={() => setFocused(true)}
          placeholder={resolvedPlaceholder}
          autoFocus={autoFocus}
          disabled={disabled}
          id={id}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={errorMessage ? 'true' : undefined}
          data-crud-focus-target=""
          className={cn(
            'flex-1 min-w-0 bg-transparent px-3 py-2 text-sm leading-5 outline-none',
            'placeholder:text-muted-foreground',
            'disabled:cursor-not-allowed disabled:text-muted-foreground',
          )}
        />
      </div>
      {errorMessage ? (
        <p id={errorId} role="alert" className="text-xs text-status-error-text">{errorMessage}</p>
      ) : null}
      {!disabled && duplicate && duplicateLabel ? (
        <p className="text-xs text-status-warning-text">
          {duplicateLabel(duplicate)}{' '}
          <a className="font-medium text-brand-violet underline underline-offset-2" href={duplicate.href}>
            {resolvedDuplicateLinkLabel}
          </a>
        </p>
      ) : null}
      {!disabled && !duplicate && checking ? (
        <p className="text-xs text-muted-foreground">{resolvedCheckingLabel}</p>
      ) : null}
    </div>
  )
}
