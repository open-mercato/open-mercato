"use client"

import * as React from 'react'
import clsx from 'clsx'
import { Loader2, Pencil, Plus, Trash2, X, Settings } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import Link from 'next/link'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'

export type Translator = (key: string, fallback?: string) => string

export type CustomerAddressInput = {
  name?: string
  purpose?: string
  addressLine1: string
  addressLine2?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  isPrimary?: boolean
}

export type CustomerAddressValue = CustomerAddressInput & {
  id: string
  purpose?: string | null
}

type CustomerAddressTilesProps = {
  addresses: CustomerAddressValue[]
  onCreate: (payload: CustomerAddressInput) => Promise<void> | void
  onUpdate?: (id: string, payload: CustomerAddressInput) => Promise<void> | void
  onDelete?: (id: string) => Promise<void> | void
  t: Translator
  emptyLabel: string
  isSubmitting?: boolean
}

type DraftAddressState = {
  name: string
  purpose: string
  addressLine1: string
  addressLine2: string
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
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  isPrimary: false,
}

const serverFieldMap: Record<string, DraftFieldKey> = {
  name: 'name',
  purpose: 'purpose',
  addressLine1: 'addressLine1',
  addressLine2: 'addressLine2',
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
      return t('customers.people.detail.addresses.validation.invalid', { field: fieldLabel })
    case 'too_small':
      if (detail.minimum === 1 && detail.type === 'string') {
        return t('customers.people.detail.addresses.validation.required', { field: fieldLabel })
      }
      return t('customers.people.detail.addresses.validation.generic', { field: fieldLabel })
    case 'too_big':
      if (typeof detail.maximum === 'number') {
        return t('customers.people.detail.addresses.validation.tooLong', {
          field: fieldLabel,
          max: detail.maximum,
        })
      }
      return t('customers.people.detail.addresses.validation.generic', { field: fieldLabel })
    default:
      return t('customers.people.detail.addresses.validation.generic', { field: fieldLabel })
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
}: CustomerAddressTilesProps) {
  const scopeVersion = useOrganizationScopeVersion()
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

  const fieldLabels = React.useMemo(
    () => ({
      name: t('customers.people.detail.addresses.fields.label'),
      purpose: t('customers.people.detail.addresses.fields.type'),
      addressLine1: t('customers.people.detail.addresses.fields.line1'),
      addressLine2: t('customers.people.detail.addresses.fields.line2'),
      city: t('customers.people.detail.addresses.fields.city'),
      region: t('customers.people.detail.addresses.fields.region'),
      postalCode: t('customers.people.detail.addresses.fields.postalCode'),
      country: t('customers.people.detail.addresses.fields.country'),
      isPrimary: t('customers.people.detail.addresses.fields.primary'),
    }),
    [t]
  )

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
      const res = await apiFetch('/api/customers/dictionaries/address-types')
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('customers.people.detail.addresses.types.error')
        setTypeOptions([])
        setTypeError(message)
        return
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const normalized = items
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const raw = item as Record<string, unknown>
          const value = typeof raw.value === 'string' ? raw.value.trim() : ''
          if (!value.length) return null
          const label =
            typeof raw.label === 'string' && raw.label.trim().length
              ? raw.label.trim()
              : value
          return { value, label }
        })
        .filter((entry): entry is { value: string; label: string } => !!entry)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      setTypeOptions(normalized)
      setTypeMap(
        normalized.reduce((acc, entry) => {
          acc.set(entry.value, entry.label)
          return acc
        }, new Map<string, string>())
      )
    } catch {
      setTypeOptions([])
      setTypeError(t('customers.people.detail.addresses.types.error'))
      flash(t('customers.people.detail.addresses.types.error'), 'error')
      setTypeMap(new Map())
    } finally {
      setTypeLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    loadAddressTypes().catch(() => {})
  }, [loadAddressTypes, scopeVersion])

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
        const res = await apiFetch('/api/customers/dictionaries/address-types', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: trimmed }),
        })
        const payload: Record<string, unknown> | null = await res.json().catch(() => null)
        if (!res.ok) {
          const errorMessage =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.people.detail.addresses.types.errorSave', 'Failed to save address type')
          setTypeFormError(errorMessage)
          flash(errorMessage, 'error')
          return
        }
        await loadAddressTypes()
        const createdValue = typeof payload?.value === 'string' ? payload.value : trimmed
        setDraft((prev) => ({ ...prev, purpose: createdValue }))
        handleTypeDialogChange(false)
      } finally {
        setTypeSaving(false)
      }
    },
    [handleTypeDialogChange, loadAddressTypes, t, typeNewOption, typeSaving]
  )

  const handleFieldChange = React.useCallback(
    (key: DraftFieldKey, value: string | boolean) => {
      setDraft((prev) => ({ ...prev, [key]: value } as DraftAddressState))
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
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 ?? '',
        city: address.city ?? '',
        region: address.region ?? '',
        postalCode: address.postalCode ?? '',
        country: address.country ?? '',
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
      const message = t('customers.people.detail.addresses.validation.required', {
        field: fieldLabels.addressLine1,
      })
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
    const line2 = normalizeOptional(draft.addressLine2)
    if (line2 !== undefined) payload.addressLine2 = line2
    const city = normalizeOptional(draft.city)
    if (city !== undefined) payload.city = city
    const region = normalizeOptional(draft.region)
    if (region !== undefined) payload.region = region
    const postal = normalizeOptional(draft.postalCode)
    if (postal !== undefined) payload.postalCode = postal
    const country = normalizeOptional(draft.country)
    if (country !== undefined) payload.country = country

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

  const renderFormTile = React.useCallback(
    (key: string) => (
      <div key={key} className="rounded-lg border-2 border-dashed border-muted-foreground/50 bg-muted/20 p-4 text-sm">
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
            <label className="text-sm font-medium required">{fieldLabels.addressLine1}</label>
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
          <div className="space-y-1">
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
          <div className="grid gap-3 sm:grid-cols-2">
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
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
              <label className="text-sm font-medium">{fieldLabels.country}</label>
              <input
                className={getInputClass('country')}
                value={draft.country}
                onChange={(event) => handleFieldChange('country', event.target.value)}
                disabled={disableActions}
                aria-invalid={fieldErrors.country ? 'true' : undefined}
              />
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
      getInputClass,
      handleCancel,
      handleFieldChange,
      handleSave,
      handleTypeDialogChange,
      handleTypeSubmit,
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
      <div className="flex items-start justify-between gap-3">
        {addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-none">{emptyLabel}</p>
        ) : (
          <span className="text-sm font-medium text-muted-foreground" aria-hidden="true" />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={openCreateForm}
          disabled={addDisabled}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('customers.people.detail.addresses.add')}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {addresses.map((address) =>
          isFormOpen && editingId === address.id ? (
            renderFormTile(address.id)
          ) : (
            <div key={address.id} className="rounded-lg border bg-background p-4 text-sm shadow-sm">
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
                <p>{address.addressLine1}</p>
                {address.addressLine2 ? <p>{address.addressLine2}</p> : null}
                <p>{[address.city, address.region, address.postalCode].filter(Boolean).join(', ')}</p>
                {address.country ? <p>{address.country}</p> : null}
              </div>
            </div>
          )
        )}
        {isFormOpen && !editingId ? renderFormTile('__new') : null}
      </div>
    </div>
  )
}
