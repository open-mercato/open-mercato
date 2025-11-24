"use client"

import * as React from 'react'
import clsx from 'clsx'
import { Loader2, Pencil, Plus, Trash2, X, Settings } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import Link from 'next/link'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { buildCountryOptions } from '@open-mercato/shared/lib/location/countries'
import { AddressView, formatAddressJson, formatAddressString, type AddressFormatStrategy } from '../utils/addressFormat'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { useQueryClient } from '@tanstack/react-query'
import { ensureCustomerDictionary, invalidateCustomerDictionary } from './detail/hooks/useCustomerDictionary'

export type Translator = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string

export type CustomerAddressInput = {
  name?: string
  purpose?: string
  companyName?: string
  addressLine1: string
  addressLine2?: string
  buildingNumber?: string
  flatNumber?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  isPrimary?: boolean
}

export type CustomerAddressValue = CustomerAddressInput & {
  id: string
  purpose?: string | null
  companyName?: string | null
}

type CustomerAddressTilesProps = {
  addresses: CustomerAddressValue[]
  onCreate: (payload: CustomerAddressInput) => Promise<void> | void
  onUpdate?: (id: string, payload: CustomerAddressInput) => Promise<void> | void
  onDelete?: (id: string) => Promise<void> | void
  t: Translator
  emptyLabel: string
  isSubmitting?: boolean
  gridClassName?: string
  hideAddButton?: boolean
  onAddActionChange?: (action: { openCreateForm: () => void; addDisabled: boolean } | null) => void
  emptyStateTitle?: string
  emptyStateActionLabel?: string
}

type DraftAddressState = {
  name: string
  purpose: string
  companyName: string
  addressLine1: string
  addressLine2: string
  buildingNumber: string
  flatNumber: string
  city: string
  region: string
  postalCode: string
  country: string
  isPrimary: boolean
}

type DraftFieldKey = keyof DraftAddressState

type AddressValidationDetail = {
  path?: Array<string | number>
  code?: string
  message?: string
  minimum?: number
  maximum?: number
  type?: string
}

const defaultDraft: DraftAddressState = {
  name: '',
  purpose: '',
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  buildingNumber: '',
  flatNumber: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  isPrimary: false,
}

const serverFieldMap: Record<string, DraftFieldKey> = {
  name: 'name',
  purpose: 'purpose',
  companyName: 'companyName',
  addressLine1: 'addressLine1',
  addressLine2: 'addressLine2',
  buildingNumber: 'buildingNumber',
  flatNumber: 'flatNumber',
  city: 'city',
  region: 'region',
  postalCode: 'postalCode',
  country: 'country',
  isPrimary: 'isPrimary',
}

function normalizeOptional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function extractValidationDetails(error: unknown): AddressValidationDetail[] {
  if (!error || typeof error !== 'object') return []
  const candidate = (error as { details?: unknown }).details
  if (!Array.isArray(candidate)) return []
  return candidate
    .map((entry) => (entry && typeof entry === 'object' ? (entry as AddressValidationDetail) : null))
    .filter((entry): entry is AddressValidationDetail => entry !== null)
}

function resolveFieldMessage(detail: AddressValidationDetail, fieldLabel: string, t: Translator): string {
  switch (detail.code) {
    case 'invalid_type':
      return t('customers.people.detail.addresses.validation.invalid', undefined, { field: fieldLabel })
    case 'too_small':
      if (detail.minimum === 1 && detail.type === 'string') {
        return t('customers.people.detail.addresses.validation.required', undefined, { field: fieldLabel })
      }
      return t('customers.people.detail.addresses.validation.generic', undefined, { field: fieldLabel })
    case 'too_big':
      if (typeof detail.maximum === 'number') {
        return t(
          'customers.people.detail.addresses.validation.tooLong',
          undefined,
          {
            field: fieldLabel,
            max: detail.maximum,
          }
        )
      }
      return t('customers.people.detail.addresses.validation.generic', undefined, { field: fieldLabel })
    default:
      return t('customers.people.detail.addresses.validation.generic', undefined, { field: fieldLabel })
  }
}

export function CustomerAddressTiles({
  addresses,
  onCreate,
  onUpdate,
  onDelete,
  t,
  emptyLabel,
  isSubmitting = false,
  gridClassName = 'grid gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
  hideAddButton = false,
  onAddActionChange,
  emptyStateTitle,
  emptyStateActionLabel,
}: CustomerAddressTilesProps) {
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const [isFormOpen, setIsFormOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<DraftAddressState>(defaultDraft)
  const [saving, setSaving] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [generalError, setGeneralError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<DraftFieldKey, string>>>({})
  const [typeOptions, setTypeOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [typeLoading, setTypeLoading] = React.useState(false)
  const [typeSaving, setTypeSaving] = React.useState(false)
  const [typeDialogOpen, setTypeDialogOpen] = React.useState(false)
  const [typeNewOption, setTypeNewOption] = React.useState('')
  const [typeFormError, setTypeFormError] = React.useState<string | null>(null)
  const [typeMap, setTypeMap] = React.useState<Map<string, string>>(new Map())
  const [typeError, setTypeError] = React.useState<string | null>(null)
  const [format, setFormat] = React.useState<AddressFormatStrategy>('line_first')
  const [formatLoading, setFormatLoading] = React.useState(false)
  const [countryDialogOpen, setCountryDialogOpen] = React.useState(false)
  const [countryQuery, setCountryQuery] = React.useState('')

  const fieldLabels = React.useMemo(
    () => ({
      name: t('customers.people.detail.addresses.fields.label'),
      purpose: t('customers.people.detail.addresses.fields.type'),
      companyName: t('customers.people.detail.addresses.fields.companyName', 'Company name'),
      addressLine1: t('customers.people.detail.addresses.fields.line1'),
      addressLine2: t('customers.people.detail.addresses.fields.line2'),
      street: t('customers.people.detail.addresses.fields.street', 'Street'),
      buildingNumber: t('customers.people.detail.addresses.fields.buildingNumber', 'Building number'),
      flatNumber: t('customers.people.detail.addresses.fields.flatNumber', 'Flat number'),
      city: t('customers.people.detail.addresses.fields.city'),
      region: t('customers.people.detail.addresses.fields.region'),
      postalCode: t('customers.people.detail.addresses.fields.postalCode'),
      country: t('customers.people.detail.addresses.fields.country'),
      isPrimary: t('customers.people.detail.addresses.fields.primary'),
    }),
    [t]
  )

  const countryOptions = React.useMemo(
    () =>
      buildCountryOptions({
        transformLabel: (code, fallback) => t(`customers.countries.${code.toLowerCase()}`, fallback ?? code),
      }),
    [t]
  )

  const filteredCountryOptions = React.useMemo(() => {
    const query = countryQuery.trim().toLowerCase()
    if (!query.length) return countryOptions
    return countryOptions.filter((option) =>
      option.label.toLowerCase().includes(query) || option.code.toLowerCase().includes(query)
    )
  }, [countryOptions, countryQuery])

  const selectedCountry = React.useMemo(() => {
    const code = draft.country?.toUpperCase() ?? ''
    if (!code.length) return null
    return countryOptions.find((option) => option.code === code) ?? null
  }, [countryOptions, draft.country])

  const getInputClass = React.useCallback(
    (key: DraftFieldKey) =>
      clsx(
        'w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
        fieldErrors[key] ? 'border-red-500 focus:ring-red-500' : undefined
      ),
    [fieldErrors]
  )

  const resetForm = React.useCallback(() => {
    setDraft(defaultDraft)
    setFieldErrors({})
    setGeneralError(null)
    setEditingId(null)
  }, [])

  const loadAddressTypes = React.useCallback(async () => {
    setTypeLoading(true)
    setTypeError(null)
    try {
      const data = await ensureCustomerDictionary(queryClient, 'address-types', scopeVersion)
      const normalized = data.entries
        .map((entry) => ({
          value: entry.value,
          label: entry.label,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      setTypeOptions(normalized)
      setTypeMap(
        normalized.reduce((acc, entry) => {
          acc.set(entry.value, entry.label)
          return acc
        }, new Map<string, string>()),
      )
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.people.detail.addresses.types.error')
      setTypeOptions([])
      setTypeError(message)
      flash(message, 'error')
      setTypeMap(new Map())
    } finally {
      setTypeLoading(false)
    }
  }, [queryClient, scopeVersion, t])

  React.useEffect(() => {
    loadAddressTypes().catch(() => {})
  }, [loadAddressTypes, scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    async function loadFormat() {
      setFormatLoading(true)
      try {
        const call = await apiCall<{ addressFormat?: string; error?: string }>(
          '/api/customers/settings/address-format',
        )
        const payload = (call.result ?? {}) as Record<string, unknown>
        if (!call.ok) {
          if (!cancelled) {
            const message =
              typeof (payload as Record<string, unknown>)?.error === 'string'
                ? (payload as Record<string, unknown>).error as string
                : t('customers.people.detail.addresses.formatLoadError', 'Failed to load address configuration')
            flash(message, 'error')
          }
          return
        }
        const valueRaw = payload?.addressFormat
        const value = typeof valueRaw === 'string' ? valueRaw : null
        if (!cancelled && (value === 'street_first' || value === 'line_first')) {
          setFormat(value)
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error && err.message
              ? err.message
              : t('customers.people.detail.addresses.formatLoadError', 'Failed to load address configuration')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setFormatLoading(false)
      }
    }
    loadFormat().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [scopeVersion, t])

  const handleTypeDialogChange = React.useCallback((open: boolean) => {
    setTypeDialogOpen(open)
    if (!open) {
      setTypeNewOption('')
      setTypeFormError(null)
      setTypeSaving(false)
    }
  }, [])

  const handleTypeSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (typeSaving) return
      const trimmed = typeNewOption.trim()
      if (!trimmed.length) {
        setTypeFormError(t('customers.people.detail.addresses.types.emptyError', 'Please provide a value'))
        return
      }
      setTypeSaving(true)
      try {
        const call = await apiCall<Record<string, unknown>>(
          '/api/customers/dictionaries/address-types',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: trimmed }),
          },
        )
        const payload = call.result ?? null
        if (!call.ok) {
          const errorMessage =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.people.detail.addresses.types.errorSave', 'Failed to save address type')
          setTypeFormError(errorMessage)
          flash(errorMessage, 'error')
          return
        }
        await invalidateCustomerDictionary(queryClient, 'address-types')
        await loadAddressTypes()
        const createdValue = typeof payload?.value === 'string' ? payload.value : trimmed
        setDraft((prev) => ({ ...prev, purpose: createdValue }))
        handleTypeDialogChange(false)
      } finally {
        setTypeSaving(false)
      }
    },
    [handleTypeDialogChange, loadAddressTypes, queryClient, t, typeNewOption, typeSaving]
  )

  const handleFieldChange = React.useCallback(
    (key: DraftFieldKey, value: string | boolean) => {
      const nextValue =
        typeof value === 'string' && key === 'country'
          ? value.toUpperCase()
          : value
      setDraft((prev) => ({ ...prev, [key]: nextValue } as DraftAddressState))
      setFieldErrors((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    },
    []
  )

  const openCreateForm = React.useCallback(() => {
    resetForm()
    setIsFormOpen(true)
  }, [resetForm])

  const openEditForm = React.useCallback(
    (address: CustomerAddressValue) => {
      setDraft({
        name: address.name ?? '',
        purpose: address.purpose ?? '',
        companyName: address.companyName ?? '',
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 ?? '',
        buildingNumber: address.buildingNumber ?? '',
        flatNumber: address.flatNumber ?? '',
        city: address.city ?? '',
        region: address.region ?? '',
        postalCode: address.postalCode ?? '',
        country: address.country ? address.country.toUpperCase() : '',
        isPrimary: address.isPrimary ?? false,
      })
      setFieldErrors({})
      setGeneralError(null)
      setEditingId(address.id)
      setIsFormOpen(true)
    },
    []
  )

  const handleCancel = React.useCallback(() => {
    setIsFormOpen(false)
    resetForm()
  }, [resetForm])

  const handleSave = React.useCallback(async () => {
    const trimmedLine1 = draft.addressLine1.trim()
    if (!trimmedLine1.length) {
      const message = t(
        'customers.people.detail.addresses.validation.required',
        undefined,
        { field: fieldLabels.addressLine1 }
      )
      setFieldErrors((prev) => ({ ...prev, addressLine1: message }))
      setGeneralError(message)
      return
    }

    const payload: CustomerAddressInput = {
      addressLine1: trimmedLine1,
      isPrimary: draft.isPrimary,
    }

    const purpose = normalizeOptional(draft.purpose)
    if (purpose !== undefined) payload.purpose = purpose
    const name = normalizeOptional(draft.name)
    if (name !== undefined) payload.name = name
    const companyName = normalizeOptional(draft.companyName)
    if (companyName !== undefined) payload.companyName = companyName
    const line2 = normalizeOptional(draft.addressLine2)
    if (line2 !== undefined) payload.addressLine2 = line2
    const buildingNumber = normalizeOptional(draft.buildingNumber)
    if (buildingNumber !== undefined) payload.buildingNumber = buildingNumber
    const flatNumber = normalizeOptional(draft.flatNumber)
    if (flatNumber !== undefined) payload.flatNumber = flatNumber
    const city = normalizeOptional(draft.city)
    if (city !== undefined) payload.city = city
    const region = normalizeOptional(draft.region)
    if (region !== undefined) payload.region = region
    const postal = normalizeOptional(draft.postalCode)
    if (postal !== undefined) payload.postalCode = postal
    const country = normalizeOptional(draft.country)
    if (country !== undefined) payload.country = country.toUpperCase()

    setSaving(true)
    setGeneralError(null)
    setFieldErrors({})
    try {
      if (editingId && onUpdate) await onUpdate(editingId, payload)
      else await onCreate(payload)
      resetForm()
      setIsFormOpen(false)
    } catch (err) {
      const details = extractValidationDetails(err)
      if (details.length) {
        const nextErrors: Partial<Record<DraftFieldKey, string>> = {}
        for (const detail of details) {
          const path = Array.isArray(detail.path) ? detail.path : []
          const targetKey = path.length ? serverFieldMap[String(path[0])] : undefined
          if (!targetKey) continue
          const message = resolveFieldMessage(detail, fieldLabels[targetKey], t)
          if (message) nextErrors[targetKey] = message
        }
        if (Object.keys(nextErrors).length) {
          setFieldErrors(nextErrors)
          setGeneralError(Object.values(nextErrors)[0] ?? null)
          setSaving(false)
          return
        }
      }
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.people.detail.addresses.error')
      setGeneralError(message)
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, fieldLabels, onCreate, onUpdate, resetForm, t, editingId])

  const handleDelete = React.useCallback(
    async (id: string) => {
      if (!onDelete) return
      setDeletingId(id)
      try {
        await onDelete(id)
        if (editingId === id) {
          resetForm()
          setIsFormOpen(false)
        }
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.people.detail.addresses.error')
        flash(message, 'error')
      } finally {
        setDeletingId(null)
      }
    },
    [editingId, onDelete, resetForm, t]
  )

  const disableActions = saving || isSubmitting || deletingId !== null
  const isEditing = editingId !== null
  const addDisabled = disableActions || isEditing
  const hasAddresses = addresses.length > 0
  const emptyTitle = emptyStateTitle ?? emptyLabel
  const emptyActionLabel = emptyStateActionLabel ?? t('customers.people.detail.addresses.add')

  React.useEffect(() => {
    if (!onAddActionChange) return
    onAddActionChange({ openCreateForm, addDisabled })
  }, [onAddActionChange, openCreateForm, addDisabled])

  React.useEffect(
    () => () => {
      if (onAddActionChange) onAddActionChange(null)
    },
    [onAddActionChange]
  )

  const renderFormTile = React.useCallback(
    (key: string) => (
      <div
        key={key}
        className="rounded-lg border-2 border-dashed border-muted-foreground/50 bg-muted/20 p-4 text-sm"
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (disableActions) return
          void handleSave()
        }}
      >
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>
            {editingId
              ? t('customers.people.detail.addresses.editTitle')
              : t('customers.people.detail.addresses.addTitle')}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={handleCancel} disabled={disableActions}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">{fieldLabels.name}</label>
            <input
              className={getInputClass('name')}
              value={draft.name}
              onChange={(event) => handleFieldChange('name', event.target.value)}
              disabled={disableActions}
              aria-invalid={fieldErrors.name ? 'true' : undefined}
            />
            {fieldErrors.name ? <p className="text-xs text-red-600">{fieldErrors.name}</p> : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{fieldLabels.purpose}</label>
            <div className="flex items-center gap-2">
              <select
                className={clsx(
                  'h-9 w-full rounded border px-2 text-sm',
                  fieldErrors.purpose ? 'border-red-500 focus:ring-red-500' : undefined
                )}
                value={draft.purpose}
                onChange={(event) => handleFieldChange('purpose', event.target.value)}
                disabled={disableActions || typeLoading}
                aria-invalid={fieldErrors.purpose ? 'true' : undefined}
              >
                <option value="">{t('customers.people.detail.addresses.types.placeholder')}</option>
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <Dialog open={typeDialogOpen} onOpenChange={handleTypeDialogChange}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={disableActions}
                      aria-label={t('customers.people.detail.addresses.types.add')}
                      title={t('customers.people.detail.addresses.types.add')}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>{t('customers.people.detail.addresses.types.dialogTitle')}</DialogTitle>
                      <DialogDescription>
                        {t('customers.people.detail.addresses.types.prompt')}
                      </DialogDescription>
                    </DialogHeader>
                    <form className="space-y-4" onSubmit={handleTypeSubmit}>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">
                          {t('customers.people.detail.addresses.types.inputLabel')}
                        </label>
                        <input
                          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder={t('customers.people.detail.addresses.types.inputPlaceholder')}
                          value={typeNewOption}
                          onChange={(event) => {
                            setTypeNewOption(event.target.value)
                            if (typeFormError) setTypeFormError(null)
                          }}
                          autoFocus
                          disabled={typeSaving}
                        />
                      </div>
                      {typeFormError ? <p className="text-sm text-red-600">{typeFormError}</p> : null}
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => handleTypeDialogChange(false)} disabled={typeSaving}>
                          {t('customers.people.detail.addresses.types.cancel')}
                        </Button>
                        <Button type="submit" disabled={typeSaving || !typeNewOption.trim()}>
                          {typeSaving
                            ? `${t('customers.people.detail.addresses.types.save')}…`
                            : t('customers.people.detail.addresses.types.save')}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  title={t('customers.people.detail.addresses.types.manage')}
                  aria-label={t('customers.people.detail.addresses.types.manage')}
                >
                  <Link href="/backend/config/customers">
                    <Settings className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{t('customers.people.detail.addresses.types.manage')}</span>
                  </Link>
                </Button>
              </div>
            </div>
            {typeLoading ? (
              <p className="text-xs text-muted-foreground">{t('customers.people.detail.addresses.types.loading')}</p>
            ) : null}
            {typeError ? <p className="text-xs text-red-600">{typeError}</p> : null}
            {fieldErrors.purpose ? <p className="text-xs text-red-600">{fieldErrors.purpose}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{fieldLabels.companyName}</label>
            <input
              className={getInputClass('companyName')}
              value={draft.companyName}
              onChange={(event) => handleFieldChange('companyName', event.target.value)}
              disabled={disableActions}
              aria-invalid={fieldErrors.companyName ? 'true' : undefined}
            />
            {fieldErrors.companyName ? <p className="text-xs text-red-600">{fieldErrors.companyName}</p> : null}
          </div>
          {formatLoading ? (
            <p className="text-xs text-muted-foreground">{t('customers.people.detail.addresses.formatLoading', 'Loading address preferences…')}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {format === 'street_first'
                ? t('customers.people.detail.addresses.streetFormatHint', 'Using street-first layout')
                : t('customers.people.detail.addresses.lineFormatHint', 'Using address-line layout')}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium required">
                {format === 'street_first' ? fieldLabels.street : fieldLabels.addressLine1}
              </label>
              <input
                className={getInputClass('addressLine1')}
                value={draft.addressLine1}
                onChange={(event) => handleFieldChange('addressLine1', event.target.value)}
                disabled={disableActions}
                aria-invalid={fieldErrors.addressLine1 ? 'true' : undefined}
              />
              {fieldErrors.addressLine1 ? (
                <p className="text-xs text-red-600">{fieldErrors.addressLine1}</p>
              ) : null}
            </div>
            {format === 'street_first' ? (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{fieldLabels.buildingNumber}</label>
                  <input
                    className={getInputClass('buildingNumber')}
                    value={draft.buildingNumber}
                    onChange={(event) => handleFieldChange('buildingNumber', event.target.value)}
                    disabled={disableActions}
                    aria-invalid={fieldErrors.buildingNumber ? 'true' : undefined}
                  />
                  {fieldErrors.buildingNumber ? (
                    <p className="text-xs text-red-600">{fieldErrors.buildingNumber}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{fieldLabels.flatNumber}</label>
                  <input
                    className={getInputClass('flatNumber')}
                    value={draft.flatNumber}
                    onChange={(event) => handleFieldChange('flatNumber', event.target.value)}
                    disabled={disableActions}
                    aria-invalid={fieldErrors.flatNumber ? 'true' : undefined}
                  />
                  {fieldErrors.flatNumber ? (
                    <p className="text-xs text-red-600">{fieldErrors.flatNumber}</p>
                  ) : null}
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-sm font-medium">
                    {t('customers.people.detail.addresses.fields.streetExtra', fieldLabels.addressLine2)}
                  </label>
                  <input
                    className={getInputClass('addressLine2')}
                    value={draft.addressLine2}
                    onChange={(event) => handleFieldChange('addressLine2', event.target.value)}
                    disabled={disableActions}
                    aria-invalid={fieldErrors.addressLine2 ? 'true' : undefined}
                  />
                  {fieldErrors.addressLine2 ? (
                    <p className="text-xs text-red-600">{fieldErrors.addressLine2}</p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="space-y-1 sm:col-span-2">
                <label className="text-sm font-medium">{fieldLabels.addressLine2}</label>
                <input
                  className={getInputClass('addressLine2')}
                  value={draft.addressLine2}
                  onChange={(event) => handleFieldChange('addressLine2', event.target.value)}
                  disabled={disableActions}
                  aria-invalid={fieldErrors.addressLine2 ? 'true' : undefined}
                />
                {fieldErrors.addressLine2 ? (
                  <p className="text-xs text-red-600">{fieldErrors.addressLine2}</p>
                ) : null}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">{fieldLabels.postalCode}</label>
              <input
                className={getInputClass('postalCode')}
                value={draft.postalCode}
                onChange={(event) => handleFieldChange('postalCode', event.target.value)}
                disabled={disableActions}
                aria-invalid={fieldErrors.postalCode ? 'true' : undefined}
              />
              {fieldErrors.postalCode ? (
                <p className="text-xs text-red-600">{fieldErrors.postalCode}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{fieldLabels.city}</label>
              <input
                className={getInputClass('city')}
                value={draft.city}
                onChange={(event) => handleFieldChange('city', event.target.value)}
                disabled={disableActions}
                aria-invalid={fieldErrors.city ? 'true' : undefined}
              />
              {fieldErrors.city ? <p className="text-xs text-red-600">{fieldErrors.city}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{fieldLabels.region}</label>
              <input
                className={getInputClass('region')}
                value={draft.region}
                onChange={(event) => handleFieldChange('region', event.target.value)}
                disabled={disableActions}
                aria-invalid={fieldErrors.region ? 'true' : undefined}
              />
              {fieldErrors.region ? <p className="text-xs text-red-600">{fieldErrors.region}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{fieldLabels.country}</label>
              <Dialog
                open={countryDialogOpen}
                onOpenChange={(open) => {
                  setCountryDialogOpen(open)
                  if (!open) setCountryQuery('')
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={clsx(
                      'h-9 w-full justify-between truncate',
                      fieldErrors.country ? 'border-red-500 text-red-600' : undefined
                    )}
                    disabled={disableActions}
                    aria-invalid={fieldErrors.country ? 'true' : undefined}
                  >
                    <span className="truncate text-left">
                      {selectedCountry
                        ? `${selectedCountry.label}`
                        : t('customers.people.detail.addresses.countryPlaceholder', 'Select country')}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {selectedCountry ? selectedCountry.code : null}
                    </span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t('customers.people.detail.addresses.countryDialogTitle', 'Select country')}</DialogTitle>
                    <DialogDescription>
                      {t('customers.people.detail.addresses.countryDialogDescription', 'Search and choose an ISO country code.')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <input
                      className="w-full rounded border px-3 py-2 text-sm"
                      placeholder={t('customers.people.detail.addresses.countrySearch', 'Search country')}
                      value={countryQuery}
                      onChange={(event) => setCountryQuery(event.target.value)}
                    />
                    <div className="max-h-64 overflow-y-auto rounded border divide-y">
                      {filteredCountryOptions.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">
                          {t('customers.people.detail.addresses.countryEmpty', 'No matches found')}
                        </p>
                      ) : (
                        filteredCountryOptions.map((option) => {
                          const isActive = option.code === (draft.country?.toUpperCase() ?? '')
                          return (
                            <button
                              type="button"
                              key={option.code}
                              className={clsx(
                                'flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-muted',
                                isActive ? 'bg-muted' : undefined
                              )}
                              onClick={() => {
                                handleFieldChange('country', option.code)
                                setCountryDialogOpen(false)
                                setCountryQuery('')
                              }}
                            >
                              <span className="truncate">{option.label}</span>
                              <span className="text-xs text-muted-foreground">{option.code}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          handleFieldChange('country', '')
                          setCountryDialogOpen(false)
                          setCountryQuery('')
                        }}
                        disabled={disableActions}
                      >
                        {t('customers.people.detail.addresses.countryClear', 'Clear')}
                      </Button>
                      <Button type="button" onClick={() => setCountryDialogOpen(false)}>
                        {t('customers.people.detail.addresses.countryClose', 'Done')}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              {fieldErrors.country ? <p className="text-xs text-red-600">{fieldErrors.country}</p> : null}
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isPrimary}
              onChange={(event) => handleFieldChange('isPrimary', event.target.checked)}
              disabled={disableActions}
              aria-invalid={fieldErrors.isPrimary ? 'true' : undefined}
            />
            <span>{fieldLabels.isPrimary}</span>
          </label>
          {fieldErrors.isPrimary ? (
            <p className="text-xs text-red-600">{fieldErrors.isPrimary}</p>
          ) : null}
          {generalError ? <p className="text-xs text-red-600">{generalError}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={disableActions}>
              {t('customers.people.detail.addresses.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={disableActions}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {editingId
                    ? t('customers.people.detail.addresses.updating')
                    : t('customers.people.detail.addresses.saving')}
                </>
              ) : editingId ? (
                t('customers.people.detail.addresses.update')
              ) : (
                t('customers.people.detail.addresses.save')
              )}
            </Button>
          </div>
        </div>
      </div>
    ),
    [
      disableActions,
      draft,
      editingId,
      fieldErrors,
      fieldLabels,
      filteredCountryOptions,
      format,
      formatLoading,
      getInputClass,
      handleCancel,
      handleFieldChange,
      handleSave,
      handleTypeDialogChange,
      handleTypeSubmit,
      countryDialogOpen,
      countryQuery,
      selectedCountry,
      generalError,
      saving,
      t,
      typeDialogOpen,
      typeError,
      typeLoading,
      typeNewOption,
      typeOptions,
      typeFormError,
      typeSaving,
    ]
  )

  return (
    <div className="space-y-4">
      {!hideAddButton ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openCreateForm}
            disabled={addDisabled}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('customers.people.detail.addresses.add')}
          </Button>
        </div>
      ) : null}
      {hasAddresses ? (
        <div className={gridClassName}>
          {addresses.map((address) => {
            if (isFormOpen && editingId === address.id) {
              return renderFormTile(address.id)
            }
            const formattedJson = formatAddressJson(address, format)
            const formattedString = formatAddressString(address, format)

            return (
              <div
                key={address.id}
                className="rounded-lg border bg-background p-4 text-sm shadow-sm"
                title={formattedString}
                data-address-json={JSON.stringify(formattedJson)}
                data-address-string={formattedString}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {address.name ||
                        (address.purpose ? typeMap.get(address.purpose) ?? address.purpose : null) ||
                        t('customers.people.detail.address')}
                    </span>
                    {address.isPrimary ? (
                      <span className="mt-1 inline-flex w-fit rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {t('customers.people.detail.primary')}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditForm(address)}
                      disabled={disableActions}
                      aria-label={t('customers.people.detail.addresses.editAction')}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive focus-visible:text-destructive"
                      onClick={() => handleDelete(address.id)}
                      disabled={disableActions || !onDelete}
                      aria-label={t('customers.people.detail.addresses.deleteAction')}
                    >
                      {deletingId === address.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {address.purpose ? (
                    <p className="text-xs text-muted-foreground">
                      {typeMap.get(address.purpose) ?? address.purpose}
                    </p>
                  ) : null}
                  <AddressView address={address} format={format} className="space-y-1" lineClassName="text-sm" />
                </div>
              </div>
            )
          })}
          {isFormOpen && !editingId ? renderFormTile('__new') : null}
        </div>
      ) : isFormOpen && !editingId ? (
        <div className={gridClassName}>{renderFormTile('__new')}</div>
      ) : (
        <EmptyState
          title={emptyTitle}
          action={{
            label: emptyActionLabel,
            onClick: openCreateForm,
            disabled: addDisabled,
          }}
        />
      )}
    </div>
  )
}
