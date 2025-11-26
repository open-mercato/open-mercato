"use client"

import * as React from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { AddressView, formatAddressJson, formatAddressString, type AddressFormatStrategy } from '../utils/addressFormat'
import AddressEditor from './AddressEditor'
import { useAddressTypes } from './detail/hooks/useAddressTypes'
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
  const [format, setFormat] = React.useState<AddressFormatStrategy>('line_first')
  const [formatLoading, setFormatLoading] = React.useState(false)
  const { map: addressTypeMap } = useAddressTypes(t)

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



  const resetForm = React.useCallback(() => {
    setDraft(defaultDraft)
    setFieldErrors({})
    setGeneralError(null)
    setEditingId(null)
  }, [])

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
          {formatLoading ? (
            <p className="text-xs text-muted-foreground">
              {t('customers.people.detail.addresses.formatLoading', 'Loading address preferences…')}
            </p>
          ) : null}
          <AddressEditor
            value={draft}
            onChange={(next) => {
              setDraft(next)
              if (Object.keys(fieldErrors).length) {
                const nextErrors = { ...fieldErrors }
                ;(Object.keys(nextErrors) as DraftFieldKey[]).forEach((key) => {
                  const candidate = (next as Record<string, unknown>)[key]
                  if (candidate !== undefined && candidate !== null && `${candidate}`.length) {
                    delete nextErrors[key]
                  }
                })
                setFieldErrors(nextErrors)
              }
            }}
            format={format}
            t={t}
            disabled={disableActions}
            errors={fieldErrors}
            showFormatHint={!formatLoading}
          />
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
      format,
      formatLoading,
      handleCancel,
      handleSave,
      generalError,
      saving,
      t,
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
                        (address.purpose ? addressTypeMap.get(address.purpose) ?? address.purpose : null) ||
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
                      {addressTypeMap.get(address.purpose) ?? address.purpose}
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
        <TabEmptyState
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
