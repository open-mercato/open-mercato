"use client"

import * as React from 'react'
import Link from 'next/link'
import { Loader2, Trash2, Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@/lib/i18n/context'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from './hooks/useCurrencyDictionary'
import {
  InlineTextEditor,
  InlineDictionaryEditor,
  InlineNextInteractionEditor,
  type InlineFieldProps,
} from './InlineEditors'

type CompanyHighlightsCompany = {
  id: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  status?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  nextInteractionRefId?: string | null
  nextInteractionIcon?: string | null
  nextInteractionColor?: string | null
}

type CompanyHighlightsProfile = {
  brandName?: string | null
  legalName?: string | null
  websiteUrl?: string | null
  industry?: string | null
  annualRevenue?: string | null
} | null

type CompanyHighlightsValidators = {
  email: NonNullable<InlineFieldProps['validator']>
  phone: NonNullable<InlineFieldProps['validator']>
  displayName: NonNullable<InlineFieldProps['validator']>
  website?: NonNullable<InlineFieldProps['validator']>
  annualRevenue?: NonNullable<InlineFieldProps['validator']>
}

type AnnualRevenueEditorProps = {
  label: string
  amount: string | null
  currency: string | null
  currencyLabel: string | null
  emptyLabel: string
  validator?: NonNullable<InlineFieldProps['validator']>
  onSave: (payload: { amount: number | null; currency: string | null }) => Promise<void>
  fetchCurrencyOptions: () => Promise<Array<{ value: string; label: string }>>
  currencyLoading: boolean
  currencyError: string | null
}

function AnnualRevenueEditor({
  label,
  amount,
  currency,
  currencyLabel,
  emptyLabel,
  validator,
  onSave,
  fetchCurrencyOptions,
  currencyLoading,
  currencyError,
}: AnnualRevenueEditorProps) {
  const t = useT()
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
      dialogTitle: t('customers.companies.detail.currency.dialogTitle', 'Add currency'),
      valueLabel: t('customers.companies.detail.currency.valueLabel', 'Currency code'),
      valuePlaceholder: t('customers.companies.detail.currency.valuePlaceholder', 'e.g. USD'),
      labelLabel: t('customers.companies.detail.currency.labelLabel', 'Label'),
      labelPlaceholder: t('customers.companies.detail.currency.labelPlaceholder', 'Display name shown in UI'),
      emptyError: t('customers.companies.detail.currency.errorRequired', 'Currency code is required.'),
      cancelLabel: t('customers.companies.detail.currency.cancel', 'Cancel'),
      saveLabel: t('customers.companies.detail.currency.save', 'Save'),
      errorLoad: t('customers.companies.detail.currency.errorLoad', 'Failed to load currency dictionary.'),
      errorSave: t('customers.companies.detail.currency.errorSave', 'Failed to save currency option.'),
      loadingLabel: t('customers.companies.detail.currency.loading', 'Loading currencies…'),
      manageTitle: t('customers.companies.detail.currency.manage', 'Manage currency dictionary'),
    }),
    [t],
  )

  const handleSave = React.useCallback(async () => {
    const trimmedAmount = draftAmount.trim()
    let validationError: string | null = null
    if (validator) {
      validationError = validator(trimmedAmount)
    }
    if (validationError) {
      setError(validationError)
      return
    }
    let normalizedAmount: number | null = null
    if (trimmedAmount.length) {
      const numeric = Number(trimmedAmount.replace(/,/g, ''))
      if (Number.isNaN(numeric)) {
        setError(t('customers.companies.detail.inline.annualRevenueInvalid', 'Enter a non-negative number.'))
        return
      }
      if (numeric < 0) {
        setError(t('customers.companies.detail.inline.annualRevenueInvalid', 'Enter a non-negative number.'))
        return
      }
      normalizedAmount = numeric
    }
    const normalizedCurrency = draftCurrency.trim().length ? draftCurrency.trim().toUpperCase() : null
    setSaving(true)
    setError(null)
    try {
      await onSave({ amount: normalizedAmount, currency: normalizedCurrency })
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('customers.companies.detail.inline.error', 'Unable to update company.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draftAmount, draftCurrency, onSave, t, validator])

  return (
    <div className="group rounded border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex-1 cursor-pointer"
          role={editing ? undefined : 'button'}
          tabIndex={editing ? undefined : 0}
          onClick={() => {
            if (!editing) setEditing(true)
          }}
          onKeyDown={(event) => {
            if (editing) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setEditing(true)
            }
          }}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <div className="mt-1">{display}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={
            editing
              ? 'opacity-100 transition-opacity duration-150'
              : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100'
          }
          onClick={() => setEditing((prev) => !prev)}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">{editing ? t('ui.forms.actions.cancel') : t('ui.forms.actions.edit')}</span>
        </Button>
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('customers.companies.detail.highlights.annualRevenue', 'Annual revenue')}
            </label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={draftAmount}
              onChange={(event) => {
                setDraftAmount(event.target.value)
                if (error) setError(null)
              }}
              placeholder={t('customers.companies.detail.highlights.annualRevenuePlaceholder', 'Enter amount')}
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
              disabled={currencyLoading}
              showLabelInput={false}
            />
            {currencyError ? <p className="text-xs text-muted-foreground">{currencyError}</p> : null}
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

export type CompanyHighlightsProps = {
  company: CompanyHighlightsCompany
  profile: CompanyHighlightsProfile
  validators: CompanyHighlightsValidators
  annualRevenueCurrency: string | null
  onDisplayNameSave: (value: string | null) => Promise<void>
  onPrimaryEmailSave: (value: string | null) => Promise<void>
  onPrimaryPhoneSave: (value: string | null) => Promise<void>
  onStatusSave: (value: string | null) => Promise<void>
  onNextInteractionSave: (payload: {
    at: string | null
    name: string | null
    refId: string | null
    icon: string | null
    color: string | null
  } | null) => Promise<void>
  onBrandNameSave: (value: string | null) => Promise<void>
  onLegalNameSave: (value: string | null) => Promise<void>
  onWebsiteUrlSave: (value: string | null) => Promise<void>
  onIndustrySave: (value: string | null) => Promise<void>
  onAnnualRevenueChange: (payload: { amount: number | null; currency: string | null }) => Promise<void>
  onDelete: () => void
  isDeleting: boolean
}

export function CompanyHighlights({
  company,
  profile,
  validators,
  annualRevenueCurrency,
  onAnnualRevenueChange,
  onDisplayNameSave,
  onPrimaryEmailSave,
  onPrimaryPhoneSave,
  onStatusSave,
  onNextInteractionSave,
  onBrandNameSave,
  onLegalNameSave,
  onWebsiteUrlSave,
  onIndustrySave,
  onDelete,
  isDeleting,
}: CompanyHighlightsProps) {
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

  const resolveCurrencyLabel = React.useCallback(
    (code: string | null | undefined): string | null => {
      if (!code || !currencyDictionary?.entries) return code ?? null
      const entry = currencyDictionary.entries.find((candidate) => candidate.value === code)
      if (!entry) return code
      return entry.label || entry.value
    },
    [currencyDictionary?.entries],
  )

  const fetchCurrencyOptions = React.useCallback(async () => {
    if (currencyDictionary && currencyDictionary.entries.length) {
      return currencyDictionary.entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
      }))
    }
    const payload = await refetchCurrencyDictionary()
    return payload.entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
    }))
  }, [currencyDictionary, refetchCurrencyDictionary])

  const resolvedCurrencyLabel = resolveCurrencyLabel(annualRevenueCurrency)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/backend/customers/companies"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden className="mr-1 text-base">←</span>
            <span className="sr-only">{t('customers.companies.detail.actions.backToList', 'Back to companies')}</span>
          </Link>
          <InlineTextEditor
            label={t('customers.companies.form.displayName.label', 'Display name')}
            value={company.displayName}
            placeholder={t('customers.companies.form.displayName.placeholder', 'Enter company name')}
            emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
            validator={validators.displayName}
            onSave={onDisplayNameSave}
            hideLabel
            variant="plain"
            activateOnClick
            triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            containerClassName="max-w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            className="rounded-none border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t('customers.companies.detail.actions.delete', 'Delete company')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.brandName', 'Brand name')}
          value={profile?.brandName ?? null}
          placeholder={t('customers.companies.detail.highlights.brandNamePlaceholder', 'Add brand name')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          onSave={onBrandNameSave}
          activateOnClick
        />
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.legalName', 'Legal name')}
          value={profile?.legalName ?? null}
          placeholder={t('customers.companies.detail.highlights.legalNamePlaceholder', 'Add legal name')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          onSave={onLegalNameSave}
          activateOnClick
        />
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.website', 'Website')}
          value={profile?.websiteUrl ?? null}
          placeholder={t('customers.companies.detail.highlights.websitePlaceholder', 'https://example.com')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          type="url"
          validator={validators.website}
          onSave={onWebsiteUrlSave}
          activateOnClick
        />
        <InlineDictionaryEditor
          label={t('customers.companies.detail.highlights.industry', 'Industry')}
          value={profile?.industry ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          kind="industries"
          onSave={onIndustrySave}
          activateOnClick
        />
        <AnnualRevenueEditor
          label={t('customers.companies.detail.highlights.annualRevenue', 'Annual revenue')}
          amount={profile?.annualRevenue ?? null}
          currency={annualRevenueCurrency ?? null}
          currencyLabel={resolvedCurrencyLabel}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          validator={validators.annualRevenue}
          onSave={onAnnualRevenueChange}
          fetchCurrencyOptions={fetchCurrencyOptions}
          currencyLoading={currencyDictionaryLoading}
          currencyError={currencyDictionaryError}
        />
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.primaryEmail', 'Primary email')}
          value={company.primaryEmail || ''}
          placeholder={t('customers.companies.form.primaryEmail', 'Add email')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          type="email"
          validator={validators.email}
          recordId={company.id}
          activateOnClick
          onSave={onPrimaryEmailSave}
        />
        <InlineTextEditor
          label={t('customers.companies.detail.highlights.primaryPhone', 'Primary phone')}
          value={company.primaryPhone || ''}
          placeholder={t('customers.companies.form.primaryPhone', 'Add phone')}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          type="tel"
          validator={validators.phone}
          recordId={company.id}
          activateOnClick
          onSave={onPrimaryPhoneSave}
        />
        <InlineDictionaryEditor
          label={t('customers.companies.detail.highlights.status', 'Status')}
          value={company.status ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          activateOnClick
          onSave={onStatusSave}
          kind="statuses"
        />
        <InlineNextInteractionEditor
          label={t('customers.companies.detail.highlights.nextInteraction', 'Next interaction')}
          valueAt={company.nextInteractionAt || null}
          valueName={company.nextInteractionName || null}
          valueRefId={company.nextInteractionRefId || null}
          valueIcon={company.nextInteractionIcon || null}
          valueColor={company.nextInteractionColor || null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          onSave={onNextInteractionSave}
          activateOnClick
        />
      </div>
    </div>
  )
}

export default CompanyHighlights
