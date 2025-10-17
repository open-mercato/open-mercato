"use client"

import * as React from 'react'

export type PhoneDuplicateMatch = {
  id: string
  label: string
  href: string
}

export type PhoneNumberFieldProps = {
  value?: string | null
  onValueChange: (next: string | undefined) => void
  onDigitsChange?: (digits: string | null) => void
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
  minDigits?: number
  checkingLabel?: string
  duplicateLabel?: (match: PhoneDuplicateMatch) => string
  duplicateLinkLabel?: string
  onDuplicateLookup?: (normalizedValue: string) => Promise<PhoneDuplicateMatch | null>
}

const DEFAULT_MIN_DIGITS = 6
const DIGIT_PATTERN = /\d+/g

const digitsOnly = (value: string): string => {
  const matches = value.match(DIGIT_PATTERN)
  return matches ? matches.join('') : ''
}

const formatPhoneNumber = (digits: string): string => {
  if (!digits) return ''
  return `+${digits}`
}

export function PhoneNumberField({
  value,
  onValueChange,
  onDigitsChange,
  disabled = false,
  autoFocus,
  placeholder,
  minDigits = DEFAULT_MIN_DIGITS,
  checkingLabel,
  duplicateLabel,
  duplicateLinkLabel,
  onDuplicateLookup,
}: PhoneNumberFieldProps) {
  const [local, setLocal] = React.useState<string>(() => {
    if (!value) return ''
    return formatPhoneNumber(digitsOnly(String(value)))
  })
  const [duplicate, setDuplicate] = React.useState<PhoneDuplicateMatch | null>(null)
  const [checking, setChecking] = React.useState(false)

  React.useEffect(() => {
    if (!value) {
      setLocal('')
      onDigitsChange?.(null)
      return
    }
    const normalizedDigits = digitsOnly(String(value))
    const formatted = formatPhoneNumber(normalizedDigits)
    setLocal(formatted)
    onDigitsChange?.(normalizedDigits || null)
  }, [value, onDigitsChange])

  React.useEffect(() => {
    if (!onDuplicateLookup || disabled) {
      setDuplicate(null)
      setChecking(false)
      return
    }
    const digits = digitsOnly(local)
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
  }, [local, disabled, minDigits, onDuplicateLookup])

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      const cleanDigits = digitsOnly(next)
      if (!cleanDigits) {
        setLocal('')
        onValueChange(undefined)
        onDigitsChange?.(null)
        return
      }
      const formatted = formatPhoneNumber(cleanDigits)
      setLocal(formatted)
      onValueChange(formatted)
      onDigitsChange?.(cleanDigits)
    },
    [onValueChange, onDigitsChange]
  )

  return (
    <div className="space-y-2">
      <input
        type="tel"
        className="w-full h-9 rounded border px-2 text-sm"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        data-crud-focus-target=""
      />
      {!disabled && duplicate && duplicateLabel && duplicateLinkLabel ? (
        <p className="text-xs text-amber-600">
          {duplicateLabel(duplicate)}{' '}
          <a className="font-medium text-primary underline underline-offset-2" href={duplicate.href}>
            {duplicateLinkLabel}
          </a>
        </p>
      ) : null}
      {!disabled && !duplicate && checking && checkingLabel ? (
        <p className="text-xs text-muted-foreground">{checkingLabel}</p>
      ) : null}
    </div>
  )
}
