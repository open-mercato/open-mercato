"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type RecordSelectTargetType =
  | 'customer_person'
  | 'customer_company'
  | 'sales_order'
  | 'sales_quote'
  | 'sales_invoice'
  | 'sales_credit_memo'

export type RecordSelectPickedRecord = {
  id: string
  label: string
  amountMinor: string | null
  currency: string | null
}

type RecordSelectProps = {
  id?: string
  targetType: RecordSelectTargetType
  value: string | null | undefined
  onChange: (value: string | null) => void
  onPicked?: (record: RecordSelectPickedRecord) => void
  disabled?: boolean
}

type RecordSearchSource = {
  path: string
  labelKeys: readonly string[]
  amountKeys?: readonly string[]
  currencyKeys?: readonly string[]
}

type RecordsResponse = {
  items?: unknown[]
}

type RecordOption = RecordSelectPickedRecord

type SelectedLabelState = {
  targetType: RecordSelectTargetType
  id: string
  label: string
}

export const recordSelectSources: Readonly<Record<RecordSelectTargetType, RecordSearchSource>> = {
  customer_person: {
    path: '/api/customers/people',
    labelKeys: ['display_name', 'displayName', 'full_name', 'fullName', 'name'],
  },
  customer_company: {
    path: '/api/customers/companies',
    labelKeys: ['display_name', 'displayName', 'business_name', 'businessName', 'company_name', 'companyName', 'legal_name', 'brand_name', 'name'],
  },
  sales_order: {
    path: '/api/sales/orders',
    labelKeys: ['orderNumber', 'order_number', 'number'],
    amountKeys: ['grandTotalGrossAmount', 'grand_total_gross_amount', 'totalGrossAmount', 'total_gross_amount'],
    currencyKeys: ['currencyCode', 'currency_code', 'currency'],
  },
  sales_quote: {
    path: '/api/sales/quotes',
    labelKeys: ['quoteNumber', 'quote_number', 'number'],
    amountKeys: ['grandTotalGrossAmount', 'grand_total_gross_amount', 'totalGrossAmount', 'total_gross_amount'],
    currencyKeys: ['currencyCode', 'currency_code', 'currency'],
  },
  sales_invoice: {
    path: '/api/sales/invoices',
    labelKeys: ['invoiceNumber', 'invoice_number', 'number'],
    amountKeys: ['grandTotalGrossAmount', 'grand_total_gross_amount', 'totalGrossAmount', 'total_gross_amount'],
    currencyKeys: ['currencyCode', 'currency_code', 'currency'],
  },
  sales_credit_memo: {
    path: '/api/sales/credit-memos',
    labelKeys: ['creditMemoNumber', 'credit_memo_number', 'number'],
    amountKeys: ['grandTotalGrossAmount', 'grand_total_gross_amount', 'totalGrossAmount', 'total_gross_amount'],
    currencyKeys: ['currencyCode', 'currency_code', 'currency'],
  },
}

export function isRecordSelectTargetType(value: string): value is RecordSelectTargetType {
  return Object.prototype.hasOwnProperty.call(recordSelectSources, value)
}

function normalizeValue(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function recordId(record: Record<string, unknown>): string | null {
  const value = record.id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function amountToMinor(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const raw = typeof value === 'number' ? String(value) : value.trim()
  if (!raw) return null
  const normalized = raw.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return null
  return String(Math.round(amount * 100))
}

function readAmountMinor(record: Record<string, unknown>, keys: readonly string[] | undefined): string | null {
  if (!keys) return null
  for (const key of keys) {
    const amount = amountToMinor(record[key])
    if (amount) return amount
  }
  return null
}

function firstNameLabel(record: Record<string, unknown>): string | null {
  const first = readString(record, ['first_name', 'firstName'])
  const last = readString(record, ['last_name', 'lastName'])
  const parts = [first, last].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' ') : null
}

function normalizeRecordOptionFromSource(source: RecordSearchSource, raw: unknown): RecordOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const id = recordId(record)
  if (!id) return null
  const label = readString(record, source.labelKeys) ?? firstNameLabel(record) ?? id
  return {
    id,
    label,
    amountMinor: readAmountMinor(record, source.amountKeys),
    currency: readString(record, source.currencyKeys ?? []),
  }
}

export function normalizeRecordOption(targetType: RecordSelectTargetType, raw: unknown): RecordOption | null {
  return normalizeRecordOptionFromSource(recordSelectSources[targetType], raw)
}

async function searchRecords(targetType: RecordSelectTargetType, query: string): Promise<RecordOption[] | 'fallback'> {
  const source = recordSelectSources[targetType]
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', '10')
  params.set('search', query.trim())
  try {
    const call = await apiCall<RecordsResponse>(`${source.path}?${params.toString()}`)
    if (call.status === 403 || call.status === 404 || !call.ok || !call.result) return 'fallback'
    return (call.result.items ?? [])
      .map((item) => normalizeRecordOptionFromSource(source, item))
      .filter((option): option is RecordOption => option !== null)
  } catch {
    return 'fallback'
  }
}

async function hydrateRecord(targetType: RecordSelectTargetType, id: string): Promise<RecordOption | null> {
  const source = recordSelectSources[targetType]
  const params = new URLSearchParams()
  params.set('ids', id)
  params.set('pageSize', '1')
  try {
    const call = await apiCall<RecordsResponse>(`${source.path}?${params.toString()}`)
    if (!call.ok || !call.result) return null
    return (call.result.items ?? [])
      .map((item) => normalizeRecordOptionFromSource(source, item))
      .find((option): option is RecordOption => option?.id === id) ?? null
  } catch {
    return null
  }
}

export function RecordSelect({
  id,
  targetType,
  value,
  onChange,
  onPicked,
  disabled = false,
}: RecordSelectProps) {
  const t = useT()
  const normalizedValue = normalizeValue(value)
  const listboxId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const blurTimerRef = React.useRef<number | null>(null)
  const [query, setQuery] = React.useState('')
  const [selectedLabelState, setSelectedLabelState] = React.useState<SelectedLabelState | null>(null)
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<RecordOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [fallbackMode, setFallbackMode] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)

  React.useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
  }, [])

  const selectedLabel = selectedLabelState?.targetType === targetType && selectedLabelState.id === normalizedValue
    ? selectedLabelState.label
    : null

  React.useEffect(() => {
    if (!normalizedValue) setSelectedLabelState(null)
  }, [normalizedValue])

  React.useEffect(() => {
    if (!normalizedValue || selectedLabel) return
    let cancelled = false
    hydrateRecord(targetType, normalizedValue).then((option) => {
      if (cancelled || !option) return
      setSelectedLabelState({
        targetType,
        id: option.id,
        label: option.label,
      })
    })
    return () => {
      cancelled = true
    }
  }, [normalizedValue, selectedLabel, targetType])

  React.useEffect(() => {
    if (!open || disabled || fallbackMode) return

    let cancelled = false
    setLoading(true)
    setError(false)
    const timer = window.setTimeout(() => {
      searchRecords(targetType, query)
        .then((result) => {
          if (cancelled) return
          if (result === 'fallback') {
            setFallbackMode(true)
            return
          }
          setOptions(result)
          setHighlightedIndex(result.length > 0 ? 0 : -1)
        })
        .catch(() => {
          if (!cancelled) {
            setOptions([])
            setError(true)
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [disabled, fallbackMode, open, query, targetType])

  const selectOption = React.useCallback((option: RecordOption) => {
    onChange(option.id)
    onPicked?.(option)
    setSelectedLabelState({ targetType, id: option.id, label: option.label })
    setQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
  }, [onChange, onPicked, targetType])

  const handleClear = React.useCallback(() => {
    if (disabled) return
    onChange(null)
    setSelectedLabelState(null)
    setQuery('')
    setOpen(false)
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }, [disabled, onChange])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || fallbackMode) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex((current) => {
        if (options.length === 0) return -1
        return current < options.length - 1 ? current + 1 : 0
      })
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex((current) => {
        if (options.length === 0) return -1
        return current > 0 ? current - 1 : options.length - 1
      })
      return
    }
    if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      const option = highlightedIndex >= 0 ? options[highlightedIndex] : null
      if (option) selectOption(option)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setQuery('')
      setHighlightedIndex(-1)
    }
  }, [disabled, fallbackMode, highlightedIndex, open, options, selectOption])

  if (fallbackMode) {
    return (
      <Input
        id={id}
        ref={inputRef}
        value={normalizedValue ?? ''}
        onChange={(event) => {
          const next = event.currentTarget.value
          onChange(next.trim().length > 0 ? next : null)
        }}
        placeholder={t('incidents.recordSelect.fallbackPlaceholder', 'Record ID')}
        disabled={disabled}
      />
    )
  }

  const displayValue = open ? query : selectedLabel ?? normalizedValue ?? ''
  const showClear = !disabled && Boolean(normalizedValue)
  const showDropdown = open && !disabled

  return (
    <div className="relative w-full">
      <Input
        id={id}
        ref={inputRef}
        value={displayValue}
        onFocus={() => {
          if (blurTimerRef.current !== null) {
            window.clearTimeout(blurTimerRef.current)
            blurTimerRef.current = null
          }
          setQuery('')
          setOpen(true)
          setHighlightedIndex(-1)
        }}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(() => {
            setOpen(false)
            setQuery('')
            setHighlightedIndex(-1)
          }, 150)
        }}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setOpen(true)
          setHighlightedIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('incidents.recordSelect.searchPlaceholder', 'Search records')}
        disabled={disabled}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-autocomplete="list"
        leftIcon={<Search aria-hidden="true" />}
        inputClassName={showClear ? 'pr-8' : undefined}
      />
      {showClear ? (
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t('incidents.recordSelect.clear', 'Clear record')}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClear}
        >
          <X className="size-3" aria-hidden="true" />
        </IconButton>
      ) : null}

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-popover mt-1 max-h-60 w-full overflow-auto rounded-md border border-input bg-popover p-2 shadow-lg"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('incidents.recordSelect.loading', 'Searching records...')}</span>
            </div>
          ) : error ? (
            <p className="px-2 py-2 text-xs text-status-error-text" role="alert">
              {t('incidents.recordSelect.error', 'Could not load records')}
            </p>
          ) : options.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {t('incidents.recordSelect.noResults', 'No matching records')}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {options.map((option, index) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  className={cn(
                    'h-auto w-full flex-col items-start justify-start rounded-md p-2 text-left font-normal',
                    index === highlightedIndex ? 'bg-muted' : '',
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="w-full truncate text-sm font-medium text-foreground" title={option.label}>
                    {option.label}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
