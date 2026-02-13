"use client"

import * as React from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { AddressView, formatAddressString, type AddressFormatStrategy } from './addressFormat'
import AddressEditor, { type AddressTypesAdapter } from './AddressEditor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'

export type Translator = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string

export type AddressInput = {
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

export type AddressValue = AddressInput & {
  id: string
  purpose?: string | null
  companyName?: string | null
}

type AddressTilesProps<C = unknown> = {
  addresses: AddressValue[]
  onCreate: (payload: AddressInput) => Promise<void> | void
  onUpdate?: (id: string, payload: AddressInput) => Promise<void> | void
  onDelete?: (id: string) => Promise<void> | void
  t: Translator
  emptyLabel: string
  isSubmitting?: boolean
  gridClassName?: string
  hideAddButton?: boolean
  onAddActionChange?: (action: { openCreateForm: () => void; addDisabled: boolean } | null) => void
  emptyStateTitle?: string
  emptyStateActionLabel?: string
  labelPrefix?: string
  addressTypesAdapter?: AddressTypesAdapter<C>
  addressTypesContext?: C
  loadFormat?: (context?: C) => Promise<AddressFormatStrategy>
  formatContext?: C
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

function resolveFieldMessage(detail: AddressValidationDetail, fieldLabel: string, t: Translator, prefix: string): string {
  const label = (suffix: string, fallback: string) => t(`${prefix}.${suffix}`, fallback)
  switch (detail.code) {
    case 'invalid_type':
      return label('validation.invalid', 'Invalid value for {{field}}').replace('{{field}}', fieldLabel)
    case 'too_small':
      if (detail.minimum === 1 && detail.type === 'string') {
        return label('validation.required', '{{field}} is required').replace('{{field}}', fieldLabel)
      }
      return label('validation.generic', 'Invalid value for {{field}}').replace('{{field}}', fieldLabel)
    case 'too_big':
      if (typeof detail.maximum === 'number') {
        return label('validation.tooLong', '{{field}} is too long').replace('{{field}}', fieldLabel)
          .replace('{{max}}', `${detail.maximum}`)
      }
      return label('validation.generic', 'Invalid value for {{field}}').replace('{{field}}', fieldLabel)
    default:
      return label('validation.generic', 'Invalid value for {{field}}').replace('{{field}}', fieldLabel)
  }
}

export function AddressTiles<C = unknown>({
  addresses,
  onCreate,
  onUpdate,
  onDelete,
  t,
  emptyLabel,
  isSubmitting = false,
  gridClassName = 'grid grid-cols-1 gap-2 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
  hideAddButton = false,
  onAddActionChange,
  emptyStateTitle,
  emptyStateActionLabel,
  labelPrefix = 'customers.people.detail.addresses',
  addressTypesAdapter,
  addressTypesContext,
  loadFormat,
  formatContext,
}: AddressTilesProps<C>) {
  const scopeVersion = useOrganizationScopeVersion()
  const [isFormOpen, setIsFormOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<DraftAddressState>(defaultDraft)
  const [saving, setSaving] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [generalError, setGeneralError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<DraftFieldKey, string>>>({})
  const [format, setFormat] = React.useState<AddressFormatStrategy>('line_first')
  const [formatLoading, setFormatLoading] = React.useState(false)

  const label = React.useCallback(
    (suffix: string, fallback?: string, params?: Record<string, string | number>) =>
      t(`${labelPrefix}.${suffix}`, fallback, params),
    [labelPrefix, t],
  )

  const fieldLabels = React.useMemo(
    () => ({
      name: label('fields.label', 'Label'),
      purpose: label('fields.type', 'Address type'),
      companyName: label('fields.companyName', 'Company name'),
      addressLine1: label('fields.line1', 'Address line 1'),
      addressLine2: label('fields.line2', 'Address line 2'),
      street: label('fields.street', 'Street'),
      buildingNumber: label('fields.buildingNumber', 'Building number'),
      flatNumber: label('fields.flatNumber', 'Flat number'),
      city: label('fields.city', 'City'),
      region: label('fields.region', 'Region'),
      postalCode: label('fields.postalCode', 'Postal code'),
      country: label('fields.country', 'Country'),
      isPrimary: label('fields.primary', 'Primary address'),
    }),
    [label],
  )

  const resetForm = React.useCallback(() => {
    setDraft(defaultDraft)
    setFieldErrors({})
    setGeneralError(null)
    setEditingId(null)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadFormatValue() {
      if (!loadFormat) {
        setFormat('line_first')
        setFormatLoading(false)
        return
      }
      setFormatLoading(true)
      try {
        const value = await loadFormat(formatContext)
        if (!cancelled && (value === 'street_first' || value === 'line_first')) {
          setFormat(value)
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error && err.message
              ? err.message
              : label('formatLoadError', 'Failed to load address configuration')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setFormatLoading(false)
      }
    }
    void loadFormatValue()
    return () => {
      cancelled = true
    }
  }, [formatContext, label, loadFormat, scopeVersion])

  const openCreateForm = React.useCallback(() => {
    resetForm()
    setIsFormOpen(true)
  }, [resetForm])

  const handleCancel = React.useCallback(() => {
    resetForm()
    setIsFormOpen(false)
  }, [resetForm])

  const handleEdit = React.useCallback((value: AddressValue) => {
    setDraft({
      name: value.name ?? '',
      purpose: value.purpose ?? '',
      companyName: value.companyName ?? '',
      addressLine1: value.addressLine1 ?? '',
      addressLine2: value.addressLine2 ?? '',
      buildingNumber: value.buildingNumber ?? '',
      flatNumber: value.flatNumber ?? '',
      city: value.city ?? '',
      region: value.region ?? '',
      postalCode: value.postalCode ?? '',
      country: value.country ?? '',
      isPrimary: value.isPrimary ?? false,
    })
    setEditingId(value.id)
    setIsFormOpen(true)
    setFieldErrors({})
    setGeneralError(null)
  }, [])

  const validate = React.useCallback((): boolean => {
    const errors: Partial<Record<DraftFieldKey, string>> = {}
    if (!draft.addressLine1.trim()) {
      errors.addressLine1 = label('validation.required', '{{field}} is required').replace('{{field}}', fieldLabels.addressLine1)
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return false
    }
    return true
  }, [draft.addressLine1, fieldLabels.addressLine1, label])

  const handleSave = React.useCallback(async () => {
    if (!validate()) return
    setSaving(true)
    setGeneralError(null)
    try {
      const payload: AddressInput = {
        name: normalizeOptional(draft.name),
        purpose: normalizeOptional(draft.purpose),
        companyName: normalizeOptional(draft.companyName),
        addressLine1: draft.addressLine1.trim(),
        addressLine2: normalizeOptional(draft.addressLine2),
        buildingNumber: normalizeOptional(draft.buildingNumber),
        flatNumber: normalizeOptional(draft.flatNumber),
        city: normalizeOptional(draft.city),
        region: normalizeOptional(draft.region),
        postalCode: normalizeOptional(draft.postalCode),
        country: normalizeOptional(draft.country)?.toUpperCase(),
        isPrimary: draft.isPrimary,
      }
      if (editingId && onUpdate) {
        await onUpdate(editingId, payload)
      } else {
        await onCreate(payload)
      }
      resetForm()
      setIsFormOpen(false)
    } catch (err) {
      const details = extractValidationDetails(err)
      if (details.length) {
        const nextErrors: Partial<Record<DraftFieldKey, string>> = {}
        details.forEach((detail) => {
          const path = Array.isArray(detail.path) ? detail.path : []
          const key = typeof path[0] === 'string' ? path[0] : undefined
          if (!key) return
          const fieldKey = serverFieldMap[key]
          if (!fieldKey) return
          const fieldLabel = fieldLabels[fieldKey] ?? key
          nextErrors[fieldKey] = resolveFieldMessage(detail, fieldLabel, t, labelPrefix)
        })
        setFieldErrors(nextErrors)
        setGeneralError(label('validation.summary', 'Please fix the highlighted fields.'))
        return
      }
      const message =
        err instanceof Error && err.message
          ? err.message
          : label('error', 'Failed to save address')
      setGeneralError(message)
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [draft, editingId, fieldLabels, label, labelPrefix, onCreate, onUpdate, resetForm, t, validate])

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
            : label('error', 'Failed to delete address')
        flash(message, 'error')
      } finally {
        setDeletingId(null)
      }
    },
    [editingId, label, onDelete, resetForm]
  )

  const disableActions = saving || isSubmitting || deletingId !== null
  const isEditing = editingId !== null
  const addDisabled = disableActions || isEditing
  const hasAddresses = addresses.length > 0
  const emptyTitle = emptyStateTitle ?? emptyLabel
  const emptyActionLabel = emptyStateActionLabel ?? label('add', 'Add address')

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
              ? label('editTitle', 'Edit address')
              : label('addTitle', 'Add address')}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={handleCancel} disabled={disableActions}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          {formatLoading ? (
            <p className="text-xs text-muted-foreground">
              {label('formatLoading', 'Loading address preferences…')}
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
            labelPrefix={labelPrefix}
            addressTypesAdapter={addressTypesAdapter}
            addressTypesContext={addressTypesContext}
          />
          {generalError ? <p className="text-xs text-red-600">{generalError}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={disableActions}>
              {label('cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={disableActions}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {editingId
                    ? label('updating', 'Updating…')
                    : label('saving', 'Saving…')}
                </>
              ) : editingId ? (
                label('update', 'Update address')
              ) : (
                label('save', 'Save address')
              )}
            </Button>
          </div>
        </div>
      </div>
    ),
    [
      addressTypesAdapter,
      addressTypesContext,
      disableActions,
      draft,
      editingId,
      fieldErrors,
      format,
      formatLoading,
      handleCancel,
      handleSave,
      generalError,
      label,
      labelPrefix,
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
            {label('add', 'Add address')}
          </Button>
        </div>
      ) : null}
      {hasAddresses ? (
        <div className={gridClassName}>
          {addresses.map((address) => {
            if (isFormOpen && editingId === address.id) {
              return renderFormTile(`form-${address.id}`)
            }
            const isDeleting = deletingId === address.id
            return (
              <div
                key={address.id}
                className="group rounded-lg border border-border/60 bg-card p-4 text-sm transition hover:border-border"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {address.name ?? label('labelFallback', 'Address')}
                      </p>
                      {address.isPrimary ? (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">
                          {label('primaryBadge', 'Primary')}
                        </span>
                      ) : null}
                    </div>
                    {address.purpose ? (
                      <p className="text-xs text-muted-foreground">
                        {address.purpose}
                      </p>
                    ) : null}
                    <AddressView address={address} format={format} className="text-sm text-foreground" />
                    <p className="text-xs text-muted-foreground">
                      {formatAddressString(address, format)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(address)}
                      disabled={disableActions}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(address.id)}
                      disabled={disableActions}
                    >
                      {isDeleting ? (
                        <span className="relative flex h-4 w-4 items-center justify-center text-destructive">
                          <span className="absolute h-4 w-4 animate-spin rounded-full border border-destructive border-t-transparent" />
                        </span>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
          {isFormOpen && !editingId ? renderFormTile('create') : null}
        </div>
      ) : isFormOpen ? (
        <div className={gridClassName}>
          {renderFormTile('create')}
        </div>
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

export default AddressTiles
