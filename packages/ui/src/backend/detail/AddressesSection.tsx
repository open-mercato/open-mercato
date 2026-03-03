"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import AddressTiles, { type AddressInput, type AddressValue } from './AddressTiles'
import type { AddressTypesAdapter } from './AddressEditor'
import type { AddressFormatStrategy } from './addressFormat'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type SectionAction = {
  label: React.ReactNode
  onClick: () => void
  disabled?: boolean
  icon?: React.ReactNode
}

export type TabEmptyStateConfig = {
  title: string
  actionLabel: string
  description?: string
}

export type AddressSummary = {
  id: string
  name?: string | null
  purpose?: string | null
  companyName?: string | null
  addressLine1: string
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  isPrimary?: boolean
}

export type AddressDataAdapter<C = unknown> = {
  list: (params: { entityId: string | null; context?: C }) => Promise<AddressSummary[]>
  create: (params: { entityId: string; payload: AddressInput; context?: C }) => Promise<{ id?: string } | void>
  update: (params: { id: string; payload: AddressInput; context?: C }) => Promise<void>
  delete: (params: { id: string; context?: C }) => Promise<void>
}

export type AddressesSectionProps<C = unknown> = {
  entityId: string | null
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyStateConfig
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
  dataAdapter: AddressDataAdapter<C>
  dataContext?: C
  addressTypesAdapter?: AddressTypesAdapter<C>
  addressTypesContext?: C
  loadFormat?: (context?: C) => Promise<AddressFormatStrategy>
  formatContext?: C
  labelPrefix?: string
}

function generateTempId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tmp_${Math.random().toString(36).slice(2)}`
}

export function AddressesSection<C = unknown>({
  entityId,
  emptyLabel,
  addActionLabel,
  emptyState,
  onActionChange,
  translator,
  onLoadingChange,
  dataAdapter,
  dataContext,
  addressTypesAdapter,
  addressTypesContext,
  loadFormat,
  formatContext,
  labelPrefix = 'customers.people.detail.addresses',
}: AddressesSectionProps<C>) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const t = translator ?? fallbackTranslator

  const label = React.useCallback(
    (suffix: string, fallback?: string, params?: Record<string, string | number>) =>
      t(`${labelPrefix}.${suffix}`, fallback, params),
    [labelPrefix, t],
  )

  const normalizedEntityId = React.useMemo(() => {
    if (typeof entityId !== 'string') return null
    const trimmed = entityId.trim()
    return trimmed.length ? trimmed : null
  }, [entityId])
  const [addresses, setAddresses] = React.useState<AddressSummary[]>([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState<boolean>(() => Boolean(normalizedEntityId))

  const loadingCounterRef = React.useRef(0)
  const pushLoading = React.useCallback(() => {
    loadingCounterRef.current += 1
    if (loadingCounterRef.current === 1) {
      onLoadingChange?.(true)
    }
  }, [onLoadingChange])
  const popLoading = React.useCallback(() => {
    loadingCounterRef.current = Math.max(0, loadingCounterRef.current - 1)
    if (loadingCounterRef.current === 0) {
      onLoadingChange?.(false)
    }
  }, [onLoadingChange])

  const loadAddresses = React.useCallback(async () => {
    if (!normalizedEntityId) {
      setAddresses([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    pushLoading()
    try {
      const items = await dataAdapter.list({ entityId: normalizedEntityId, context: dataContext })
      setAddresses(items)
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : label('error', 'Failed to load addresses.')
      flash(message, 'error')
      setAddresses([])
    } finally {
      setIsLoading(false)
      popLoading()
    }
  }, [dataAdapter, dataContext, label, normalizedEntityId, popLoading, pushLoading])

  React.useEffect(() => {
    void loadAddresses()
  }, [loadAddresses])

  const handleCreate = React.useCallback(
    async (payload: AddressInput) => {
      if (!normalizedEntityId) {
        throw new Error(label('error', 'Failed to save address.'))
      }
      pushLoading()
      setIsSubmitting(true)
      try {
        const response = await dataAdapter.create({
          entityId: normalizedEntityId,
          payload,
          context: dataContext,
        })
        const newAddress: AddressSummary = {
          id: typeof response === 'object' && response && typeof response.id === 'string' ? response.id : generateTempId(),
          name: payload.name ?? null,
          purpose: payload.purpose ?? null,
          companyName: payload.companyName ?? null,
          addressLine1: payload.addressLine1,
          addressLine2: payload.addressLine2 ?? null,
          buildingNumber: payload.buildingNumber ?? null,
          flatNumber: payload.flatNumber ?? null,
          city: payload.city ?? null,
          region: payload.region ?? null,
          postalCode: payload.postalCode ?? null,
          country: payload.country ? payload.country.toUpperCase() : null,
          isPrimary: payload.isPrimary ?? false,
        }
        setAddresses((prev) => {
          const existing = payload.isPrimary ? prev.map((addr) => ({ ...addr, isPrimary: false })) : prev
          return [newAddress, ...existing]
        })
        flash(label('success', 'Address saved.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : label('error', 'Failed to save address.')
        const error = new Error(message) as Error & { details?: unknown }
        if (err && typeof err === 'object' && (err as { details?: unknown }).details) {
          error.details = (err as { details?: unknown }).details
        }
        throw error
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [dataAdapter, dataContext, label, normalizedEntityId, popLoading, pushLoading],
  )

  const handleUpdate = React.useCallback(
    async (id: string, payload: AddressInput) => {
      if (!normalizedEntityId) {
        throw new Error(label('error', 'Failed to save address.'))
      }
      pushLoading()
      setIsSubmitting(true)
      try {
        await dataAdapter.update({ id, payload, context: dataContext })
        setAddresses((prev) => {
          return prev.map((address) => {
            if (address.id !== id) {
              return payload.isPrimary ? { ...address, isPrimary: false } : address
            }
            return {
              ...address,
              name: payload.name ?? null,
              purpose: payload.purpose ?? null,
              companyName: payload.companyName ?? null,
              addressLine1: payload.addressLine1,
              addressLine2: payload.addressLine2 ?? null,
              buildingNumber: payload.buildingNumber ?? null,
              flatNumber: payload.flatNumber ?? null,
              city: payload.city ?? null,
              region: payload.region ?? null,
              postalCode: payload.postalCode ?? null,
              country: payload.country ? payload.country.toUpperCase() : null,
              isPrimary: payload.isPrimary ?? false,
            }
          })
        })
        flash(label('success', 'Address saved.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : label('error', 'Failed to save address.')
        const error = new Error(message) as Error & { details?: unknown }
        if (err && typeof err === 'object' && (err as { details?: unknown }).details) {
          error.details = (err as { details?: unknown }).details
        }
        throw error
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [dataAdapter, dataContext, label, normalizedEntityId, popLoading, pushLoading],
  )

  const handleDelete = React.useCallback(
    async (id: string) => {
      if (!normalizedEntityId) {
        throw new Error(label('error', 'Failed to delete address.'))
      }
      pushLoading()
      setIsSubmitting(true)
      try {
        await dataAdapter.delete({ id, context: dataContext })
        setAddresses((prev) => prev.filter((address) => address.id !== id))
        flash(label('deleted', 'Address deleted.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : label('error', 'Failed to delete address.')
        flash(message, 'error')
        throw err
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [dataAdapter, dataContext, label, normalizedEntityId, popLoading, pushLoading],
  )

  const displayAddresses = React.useMemo<AddressValue[]>(() => {
    return addresses.map((address) => ({
      id: address.id,
      name: address.name ?? undefined,
      purpose: address.purpose ?? undefined,
      companyName: address.companyName ?? undefined,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? undefined,
      buildingNumber: address.buildingNumber ?? undefined,
      flatNumber: address.flatNumber ?? undefined,
      city: address.city ?? undefined,
      region: address.region ?? undefined,
      postalCode: address.postalCode ?? undefined,
      country: address.country ?? undefined,
      isPrimary: address.isPrimary ?? false,
    }))
  }, [addresses])

  const [addAction, setAddAction] = React.useState<{
    openCreateForm: () => void
    addDisabled: boolean
  } | null>(null)

  const handleAddActionChange = React.useCallback(
    (action: { openCreateForm: () => void; addDisabled: boolean } | null) => {
      setAddAction(action)
    },
    [],
  )

  React.useEffect(() => {
    if (!onActionChange) return
    if (!addAction || addresses.length === 0) {
      onActionChange(null)
      return
    }
    onActionChange({
      label: addActionLabel,
      onClick: addAction.openCreateForm,
      disabled: addAction.addDisabled,
    })
  }, [addAction, addActionLabel, addresses.length, onActionChange])

  return (
    <div className="mt-4">
      {isLoading ? (
        <div className="flex justify-center">
          <LoadingMessage
            label={label('loading', 'Loading addresses…')}
            className="min-h-[120px] w-full justify-center border-0 bg-transparent p-0"
          />
        </div>
      ) : (
        <AddressTiles
          addresses={displayAddresses}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          isSubmitting={isSubmitting}
          emptyLabel={emptyLabel}
          t={t}
          hideAddButton
          onAddActionChange={handleAddActionChange}
          emptyStateTitle={emptyState.title}
          emptyStateActionLabel={emptyState.actionLabel}
          labelPrefix={labelPrefix}
          addressTypesAdapter={addressTypesAdapter}
          addressTypesContext={addressTypesContext}
          loadFormat={loadFormat}
          formatContext={formatContext}
        />
      )}
    </div>
  )
}

export default AddressesSection
