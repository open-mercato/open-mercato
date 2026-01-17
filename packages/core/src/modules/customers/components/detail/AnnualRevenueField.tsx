"use client"

import * as React from 'react'
import { Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useCurrencyDictionary } from './hooks/useCurrencyDictionary'
import type { InlineFieldProps } from './InlineEditors'

export type AnnualRevenueFieldProps = {
  label: string
  amount: string | null
  currency: string | null
  emptyLabel: string
  validator?: NonNullable<InlineFieldProps['validator']>
  onSave: (payload: { amount: number | null; currency: string | null }) => Promise<void>
}

export function AnnualRevenueField({
  label,
  amount,
  currency,
  emptyLabel,
  validator,
  onSave,
}: AnnualRevenueFieldProps) {
  const t = useT()
  const {
    data: currencyDictionary,
    error: currencyDictionaryErrorRaw,
    isLoading: currencyDictionaryLoading,
    refetch: refetchCurrencyDictionary,
  } = useCurrencyDictionary()

  const currencyDictionaryError =
    currencyDictionaryErrorRaw instanceof Error
      ? currencyDictionaryErrorRaw.message
      : currencyDictionaryErrorRaw
        ? String(currencyDictionaryErrorRaw)
        : null

  const [editing, setEditing] = React.useState(false)
  const [draftAmount, setDraftAmount] = React.useState(() => (typeof amount === 'string' ? amount : ''))
  const [draftCurrency, setDraftCurrency] = React.useState(() => (typeof currency === 'string' ? currency : ''))
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) {
      setDraftAmount(typeof amount === 'string' ? amount : '')
      setDraftCurrency(typeof currency === 'string' ? currency : '')
      setError(null)
    }
  }, [amount, currency, editing])

  const currencyLabel = React.useMemo(() => {
    if (!currency) return null
    const entries = currencyDictionary?.entries ?? []
    const match = entries.find((entry) => entry.value === currency)
    if (!match) return currency
    return match.label || match.value
  }, [currency, currencyDictionary?.entries])

  const fetchCurrencyOptions = React.useCallback(async () => {
    if (currencyDictionary && currencyDictionary.entries.length) {
      return currencyDictionary.entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      }))
    }
    const payload = await refetchCurrencyDictionary()
    return payload.entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [currencyDictionary, refetchCurrencyDictionary])

  const display = React.useMemo(() => {
    const value = typeof amount === 'string' ? amount.trim() : ''
    if (!value.length) {
      return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
    }
    const numeric = Number(value.replace(/,/g, ''))
    let formatted = value
    if (!Number.isNaN(numeric)) {
      try {
        formatted = new Intl.NumberFormat(undefined, {
          style: currency ? 'currency' : 'decimal',
          currency: currency ?? undefined,
          maximumFractionDigits: 2,
        }).format(numeric)
      } catch {
        formatted = currency ? `${currency} ${numeric}` : `${numeric}`
      }
    }
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{formatted}</span>
        {currencyLabel ? (
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{currencyLabel}</span>
        ) : null}
      </div>
    )
  }, [amount, currency, currencyLabel, emptyLabel])

  const currencyLabels = React.useMemo(
    () => ({
      placeholder: t('customers.companies.detail.currency.placeholder', 'Select currency…'),
      addLabel: t('customers.companies.detail.currency.add', 'Add currency'),
      addPrompt: t('customers.companies.detail.currency.addPrompt', 'Enter a 3-letter ISO currency code.'),
      dialogTitle: t('customers.companies.detail.currency.dialogTitle', 'Add currency'),
      valueLabel: t('customers.companies.detail.currency.valueLabel', 'Currency code'),
      valuePlaceholder: t('customers.companies.detail.currency.valuePlaceholder', 'e.g. USD'),
      labelLabel: t('customers.companies.detail.currency.labelLabel', 'Display label (optional)'),
      labelPlaceholder: t('customers.companies.detail.currency.labelPlaceholder', 'e.g. US Dollar'),
      emptyError: t('customers.companies.detail.currency.emptyError', 'Please provide a currency code.'),
      cancelLabel: t('customers.companies.detail.currency.cancel', 'Cancel'),
      saveLabel: t('customers.companies.detail.currency.save', 'Save'),
      saveShortcutHint: t('customers.companies.detail.currency.saveShortcutHint', 'Press Enter to save'),
      successCreateLabel: t('customers.companies.detail.currency.success', 'Currency added.'),
      errorLoad: t('customers.companies.detail.currency.fetchError', 'Unable to load currencies.'),
      errorSave: t('customers.companies.detail.currency.createError', 'Unable to add currency.'),
      loadingLabel: t('customers.companies.detail.currency.loading', 'Loading currencies…'),
      manageTitle: t('customers.companies.detail.currency.manageTitle', 'Manage currencies'),
    }),
    [t],
  )

  const handleSave = React.useCallback(async () => {
    if (saving) return
    const trimmedAmount = draftAmount.trim()
    if (validator) {
      const validationError = validator(trimmedAmount)
      if (validationError) {
        setError(validationError)
        return
      }
    }
    let numeric: number | null = null
    if (trimmedAmount.length) {
      numeric = Number(trimmedAmount)
      if (Number.isNaN(numeric)) {
        setError(t('customers.companies.detail.currency.invalidAmount', 'Enter a valid amount.'))
        return
      }
    }
    setSaving(true)
    try {
      await onSave({ amount: numeric, currency: draftCurrency.trim() ? draftCurrency.trim() : null })
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.companies.detail.inline.error', 'Unable to update company.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draftAmount, draftCurrency, onSave, saving, t, validator])

  const containerClasses = React.useMemo(
    () =>
      cn('group rounded border bg-muted/20 p-3', {
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring': !editing,
      }),
    [editing],
  )

  const handleActivate = React.useCallback(() => {
    if (!editing) setEditing(true)
  }, [editing])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (editing) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleActivate()
      }
    },
    [editing, handleActivate],
  )

  return (
    <div
      className={containerClasses}
      role={editing ? undefined : 'button'}
      tabIndex={editing ? -1 : 0}
      onClick={() => {
        if (!editing) handleActivate()
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <div className="mt-1 text-sm text-foreground">{display}</div>
          {currencyDictionaryError ? (
            <p className="mt-1 text-xs text-muted-foreground">{currencyDictionaryError}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setEditing((prev) => !prev)}
          className="h-8 w-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">{editing ? t('ui.forms.actions.cancel') : t('ui.forms.actions.edit')}</span>
        </Button>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('customers.companies.detail.fields.annualRevenuePlaceholder', 'Enter amount')}
            </label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={draftAmount}
              onChange={(event) => {
                setDraftAmount(event.target.value)
                if (error) setError(null)
              }}
              placeholder={t('customers.companies.detail.fields.annualRevenuePlaceholder', 'Enter amount')}
              type="number"
              min="0"
              step="0.01"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('customers.companies.detail.highlights.annualRevenueCurrency', 'Currency')}
            </label>
            <DictionaryEntrySelect
              value={draftCurrency || undefined}
              onChange={(next) => setDraftCurrency(next ?? '')}
              fetchOptions={fetchCurrencyOptions}
              labels={currencyLabels}
              manageHref="/backend/config/dictionaries?key=currency"
              allowInlineCreate={false}
              allowAppearance={false}
              selectClassName="w-full"
              disabled={currencyDictionaryLoading}
              showLabelInput={false}
            />
          </div>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              {t('ui.forms.actions.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              {t('ui.forms.actions.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setDraftAmount('')
                setDraftCurrency('')
                if (error) setError(null)
              }}
            >
              {t('customers.companies.detail.currency.clear', 'Clear')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
