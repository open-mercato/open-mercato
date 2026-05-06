"use client"

import * as React from 'react'
import { extractPhoneDigits, validatePhoneNumber } from '@open-mercato/shared/lib/phone'
import { Input } from '../../primitives/input'

export type PhoneDuplicateMatch = {
  id: string
  label: string
  href: string
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
}

const DEFAULT_MIN_DIGITS = 6
const DEFAULT_INVALID_LABEL = 'Enter a valid phone number with country code (e.g. +1 212 555 1234)'

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
}: PhoneNumberFieldProps) {
  const [local, setLocal] = React.useState<string>(() => {
    if (value == null || value === '') return ''
    return String(value)
  })
  const [duplicate, setDuplicate] = React.useState<PhoneDuplicateMatch | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [validationHint, setValidationHint] = React.useState<string | null>(null)
  const userEditingRef = React.useRef(false)
  const externalFieldError = externalError && externalError.trim().length > 0 ? externalError : null
  const errorMessage = externalFieldError ?? validationHint
  const errorId = errorMessage && id ? `${id}-error` : undefined
  const describedBy = [ariaDescribedBy, errorId].filter((part): part is string => Boolean(part)).join(' ') || undefined

  React.useEffect(() => {
    if (userEditingRef.current) return
    if (value == null || value === '') {
      setLocal('')
      onDigitsChange?.(null)
      return
    }
    const nextValue = String(value)
    setLocal(nextValue)
    onDigitsChange?.(extractPhoneDigits(nextValue) || null)
  }, [value, onDigitsChange])

  React.useEffect(() => {
    if (!onDuplicateLookup || disabled) {
      setDuplicate(null)
      setChecking(false)
      return
    }
    const digits = extractPhoneDigits(local)
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
      const cleanDigits = extractPhoneDigits(next)
      userEditingRef.current = true
      setLocal(next)
      setValidationHint(null)
      onValueChange(next.length ? next : undefined)
      onDigitsChange?.(cleanDigits.length ? cleanDigits : null)
    },
    [onValueChange, onDigitsChange]
  )

  const handleBlur = React.useCallback(() => {
    userEditingRef.current = false
    const trimmed = local.trim()
    if (!trimmed) {
      setLocal('')
      setValidationHint(null)
      onValueChange(undefined)
      onDigitsChange?.(null)
      return
    }
    const result = validatePhoneNumber(trimmed)
    if (result.valid) {
      setLocal(result.normalized ?? '')
      setValidationHint(null)
      onValueChange(result.normalized || undefined)
      onDigitsChange?.(result.digits || null)
    } else {
      setLocal(trimmed)
      setValidationHint(invalidLabel ?? DEFAULT_INVALID_LABEL)
      onValueChange(trimmed)
      onDigitsChange?.(result.digits || null)
    }
  }, [invalidLabel, local, onDigitsChange, onValueChange])

  return (
    <div className="space-y-2">
      <Input
        type="tel"
        value={local}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={errorMessage ? 'true' : undefined}
        data-crud-focus-target=""
      />
      {errorMessage ? (
        <p id={errorId} className="text-xs text-destructive">{errorMessage}</p>
      ) : null}
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
