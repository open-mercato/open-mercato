"use client"

import * as React from 'react'
import clsx from 'clsx'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export type Translator = (key: string, fallback?: string) => string

export type CustomerAddressInput = {
  name?: string
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

function resolveFieldMessage(
  detail: AddressValidationDetail,
  fieldLabel: string,
  t: Translator
): string {
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
  const [isFormOpen, setIsFormOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<DraftAddressState>(defaultDraft)
  const [saving, setSaving] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [generalError, setGeneralError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<DraftFieldKey, string>>>({})

  const fieldLabels = React.useMemo(
    () => ({
      name: t('customers.people.detail.addresses.fields.label'),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <span className="text-sm font-medium text-muted-foreground" aria-hidden="true">
            &nbsp;
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openCreateForm}
          disabled={disableActions}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('customers.people.detail.addresses.add')}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {addresses.map((address) => (
          <div key={address.id} className="rounded-lg border bg-background p-4 text-sm shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {address.name || address.purpose || t('customers.people.detail.address')}
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
              <p>{address.addressLine1}</p>
              {address.addressLine2 ? <p>{address.addressLine2}</p> : null}
              <p>{[address.city, address.region, address.postalCode].filter(Boolean).join(', ')}</p>
              {address.country ? <p>{address.country}</p> : null}
            </div>
          </div>
        ))}
        {isFormOpen ? (
          <div className="rounded-lg border-2 border-dashed border-muted-foreground/50 bg-muted/20 p-4 text-sm">
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
                <label className="text-sm font-medium">
                  {fieldLabels.name}
                </label>
                <input
                  className={getInputClass('name')}
                  value={draft.name}
                  onChange={(event) => handleFieldChange('name', event.target.value)}
                  disabled={disableActions}
                  aria-invalid={fieldErrors.name ? 'true' : undefined}
                />
                {fieldErrors.name ? <p className="text-xs text-red-600">{fieldErrors.name}</p> : null}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium required">
                  {fieldLabels.addressLine1}
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
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {fieldLabels.addressLine2}
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    {fieldLabels.city}
                  </label>
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
                  <label className="text-sm font-medium">
                    {fieldLabels.region}
                  </label>
                  <input
                    className={getInputClass('region')}
                    value={draft.region}
                    onChange={(event) => handleFieldChange('region', event.target.value)}
                    disabled={disableActions}
                    aria-invalid={fieldErrors.region ? 'true' : undefined}
                  />
                  {fieldErrors.region ? (
                    <p className="text-xs text-red-600">{fieldErrors.region}</p>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    {fieldLabels.postalCode}
                  </label>
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
                  <label className="text-sm font-medium">
                    {fieldLabels.country}
                  </label>
                  <input
                    className={getInputClass('country')}
                    value={draft.country}
                    onChange={(event) => handleFieldChange('country', event.target.value)}
                    disabled={disableActions}
                    aria-invalid={fieldErrors.country ? 'true' : undefined}
                  />
                  {fieldErrors.country ? (
                    <p className="text-xs text-red-600">{fieldErrors.country}</p>
                  ) : null}
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
        ) : null}
      </div>
    </div>
  )
}
