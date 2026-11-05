"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from '../hooks/useCurrencyDictionary'

const CURRENCY_PRIORITY = ['EUR', 'USD', 'GBP', 'PLN'] as const

export type DealCurrencyFieldProps = {
  id?: string
  value: string
  onChange: (code: string) => void
  disabled?: boolean
}

export function DealCurrencyField({ id, value, onChange, disabled = false }: DealCurrencyFieldProps) {
  const t = useT()
  const { data, error: rawError, isLoading, refetch } = useCurrencyDictionary()
  const dictError = rawError
    ? rawError instanceof Error
      ? rawError.message
      : String(rawError)
    : null

  const resolvedError = React.useMemo(() => {
    if (dictError) return dictError
    if (!isLoading && !data) {
      return t('customers.deals.form.currency.missing', 'Currency dictionary is not configured yet.')
    }
    return null
  }, [data, dictError, isLoading, t])

  const fetchOptions = React.useCallback(async () => {
    let payload = data ?? null
    if (!payload) {
      try {
        payload = await refetch()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err ?? '')
        throw new Error(message || t('customers.deals.form.currency.error', 'Failed to load currency dictionary.'))
      }
    }
    if (!payload) {
      throw new Error(t('customers.deals.form.currency.missing', 'Currency dictionary is not configured yet.'))
    }
    const priorityOrder = new Map<string, number>()
    CURRENCY_PRIORITY.forEach((code, index) => priorityOrder.set(code, index))
    const prioritized: { value: string; label: string; color: string | null; icon: string | null }[] = []
    const remainder: { value: string; label: string; color: string | null; icon: string | null }[] = []
    payload.entries.forEach((entry) => {
      const code = entry.value.toUpperCase()
      const label = entry.label && entry.label.length ? `${code} – ${entry.label}` : code
      const option = { value: code, label, color: null, icon: null }
      if (priorityOrder.has(code)) prioritized.push(option)
      else remainder.push(option)
    })
    prioritized.sort((a, b) => priorityOrder.get(a.value)! - priorityOrder.get(b.value)!)
    remainder.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return [...prioritized, ...remainder]
  }, [data, refetch, t])

  const labels = React.useMemo(
    () => ({
      placeholder: t('customers.deals.form.currency.placeholder', 'Select currency…'),
      addLabel: t('customers.deals.form.currency.add', 'Add currency'),
      dialogTitle: t('customers.deals.form.currency.dialogTitle', 'Add currency'),
      valueLabel: t('customers.deals.form.currency.valueLabel', 'Currency code'),
      valuePlaceholder: t('customers.deals.form.currency.valuePlaceholder', 'e.g. USD'),
      labelLabel: t('customers.deals.form.currency.labelLabel', 'Label'),
      labelPlaceholder: t('customers.deals.form.currency.labelPlaceholder', 'Display name shown in UI'),
      emptyError: t('customers.deals.form.currency.error.required', 'Currency code is required.'),
      cancelLabel: t('customers.deals.form.currency.cancel', 'Cancel'),
      saveLabel: t('customers.deals.form.currency.save', 'Save'),
      errorLoad: t('customers.deals.form.currency.error', 'Failed to load currency dictionary.'),
      errorSave: t('customers.deals.form.currency.error', 'Failed to load currency dictionary.'),
      loadingLabel: t('customers.deals.form.currency.loading', 'Loading currencies…'),
      manageTitle: t('customers.deals.form.currency.manage', 'Manage currency dictionary'),
    }),
    [t],
  )

  return (
    <div className="space-y-1">
      <DictionaryEntrySelect
        id={id}
        value={value || undefined}
        onChange={(next) => onChange(next ?? '')}
        fetchOptions={fetchOptions}
        labels={labels}
        manageHref="/backend/config/dictionaries?key=currency"
        allowInlineCreate={false}
        allowAppearance={false}
        sortOptions="none"
        selectClassName="w-full"
        disabled={disabled}
        showLabelInput={false}
      />
      {resolvedError ? (
        <p className={cn('text-xs', dictError ? 'text-status-error-text' : 'text-muted-foreground')}>
          {resolvedError}
        </p>
      ) : null}
    </div>
  )
}

export default DealCurrencyField
