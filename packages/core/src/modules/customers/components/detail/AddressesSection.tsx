"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import { CustomerAddressTiles, type CustomerAddressInput, type CustomerAddressValue } from '../AddressTiles'
import type { AddressSummary, SectionAction, TabEmptyState, Translator } from './types'
import { useT } from '@/lib/i18n/context'

export type AddressesSectionProps = {
  entityId: string | null
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
}

type ApiAddressPayload = Record<string, unknown>

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length) return trimmed
    }
  }
  return null
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true' || normalized === '1') return true
      if (normalized === 'false' || normalized === '0') return false
    }
  }
  return false
}

function mapAddress(input: unknown): AddressSummary | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const rawId = record.id ?? record.address_id ?? null
  const id =
    typeof rawId === 'string'
      ? rawId
      : typeof rawId === 'number' || typeof rawId === 'bigint'
        ? String(rawId)
        : null
  if (!id) return null
  const addressLine1 = readString(record, 'address_line1', 'addressLine1')
  if (!addressLine1) return null
  return {
    id,
    name: readString(record, 'name'),
    purpose: readString(record, 'purpose'),
    addressLine1,
    addressLine2: readString(record, 'address_line2', 'addressLine2'),
    buildingNumber: readString(record, 'building_number', 'buildingNumber'),
    flatNumber: readString(record, 'flat_number', 'flatNumber'),
    city: readString(record, 'city'),
    region: readString(record, 'region'),
    postalCode: readString(record, 'postal_code', 'postalCode'),
    country: readString(record, 'country'),
    isPrimary: readBoolean(record, 'is_primary', 'isPrimary'),
  }
}

export function AddressesSection({
  entityId,
  emptyLabel,
  addActionLabel,
  emptyState,
  onActionChange,
  translator,
  onLoadingChange,
}: AddressesSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(
    () => (key, fallback) => {
      const value = tHook(key)
      return value === key && fallback ? fallback : value
    },
    [tHook]
  )
  const t = translator ?? fallbackTranslator

  const [addresses, setAddresses] = React.useState<AddressSummary[]>([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const normalizedEntityId = React.useMemo(() => {
    if (typeof entityId !== 'string') return null
    const trimmed = entityId.trim()
    return trimmed.length ? trimmed : null
  }, [entityId])

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
      return
    }
    pushLoading()
    try {
      const params = new URLSearchParams({ entityId: normalizedEntityId, pageSize: '100' })
      const res = await apiFetch(`/api/customers/addresses?${params.toString()}`)
      const payload = (await res.json().catch(() => ({}))) as ApiAddressPayload
      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('customers.people.detail.addresses.error')
        throw new Error(message)
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const mapped = items
        .map(mapAddress)
        .filter((value): value is AddressSummary => value !== null)
      setAddresses(mapped)
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.people.detail.addresses.error')
      flash(message, 'error')
      setAddresses([])
    } finally {
      popLoading()
    }
  }, [normalizedEntityId, pushLoading, popLoading, t])

  React.useEffect(() => {
    loadAddresses().catch(() => {})
  }, [loadAddresses])

  const buildPayload = React.useCallback(
    (base: { id?: string }) => {
      return (payload: CustomerAddressInput) => {
        const bodyPayload: Record<string, unknown> = {
          ...base,
          addressLine1: payload.addressLine1,
          isPrimary: payload.isPrimary ?? false,
        }
        if (normalizedEntityId && !base.id) bodyPayload.entityId = normalizedEntityId
        if (typeof payload.name === 'string') bodyPayload.name = payload.name
        if (typeof payload.purpose === 'string') bodyPayload.purpose = payload.purpose
        if (typeof payload.addressLine2 === 'string') bodyPayload.addressLine2 = payload.addressLine2
        if (typeof payload.buildingNumber === 'string') bodyPayload.buildingNumber = payload.buildingNumber
        if (typeof payload.flatNumber === 'string') bodyPayload.flatNumber = payload.flatNumber
        if (typeof payload.city === 'string') bodyPayload.city = payload.city
        if (typeof payload.region === 'string') bodyPayload.region = payload.region
        if (typeof payload.postalCode === 'string') bodyPayload.postalCode = payload.postalCode
        if (typeof payload.country === 'string') bodyPayload.country = payload.country.toUpperCase()
        return bodyPayload
      }
    },
    [normalizedEntityId]
  )

  const handleCreate = React.useCallback(
    async (payload: CustomerAddressInput) => {
      if (!normalizedEntityId) {
        throw new Error(t('customers.people.detail.addresses.error'))
      }
      pushLoading()
      setIsSubmitting(true)
      try {
        const res = await apiFetch('/api/customers/addresses', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildPayload({})(payload)),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.addresses.error')
          let detailsPayload: unknown = null
          try {
            detailsPayload = await res.clone().json()
            if (
              detailsPayload &&
              typeof detailsPayload === 'object' &&
              typeof (detailsPayload as { error?: unknown }).error === 'string'
            ) {
              message = (detailsPayload as { error: string }).error
            }
          } catch {}
          const error = new Error(message) as Error & { details?: unknown }
          if (
            detailsPayload &&
            typeof detailsPayload === 'object' &&
            Array.isArray((detailsPayload as { details?: unknown }).details)
          ) {
            error.details = (detailsPayload as { details: unknown }).details
          }
          throw error
        }
        const body = await res.json().catch(() => ({}))
        const newAddress: AddressSummary = {
          id: typeof body?.id === 'string' ? body.id : generateTempId(),
          name: payload.name ?? null,
          purpose: payload.purpose ?? null,
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
        flash(t('customers.people.detail.addresses.success'), 'success')
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [normalizedEntityId, pushLoading, popLoading, t, buildPayload]
  )

  const handleUpdate = React.useCallback(
    async (id: string, payload: CustomerAddressInput) => {
      if (!normalizedEntityId) {
        throw new Error(t('customers.people.detail.addresses.error'))
      }
      pushLoading()
      setIsSubmitting(true)
      try {
        const res = await apiFetch('/api/customers/addresses', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildPayload({ id })(payload)),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.addresses.error')
          let detailsPayload: unknown = null
          try {
            detailsPayload = await res.clone().json()
            if (
              detailsPayload &&
              typeof detailsPayload === 'object' &&
              typeof (detailsPayload as { error?: unknown }).error === 'string'
            ) {
              message = (detailsPayload as { error: string }).error
            }
          } catch {}
          const error = new Error(message) as Error & { details?: unknown }
          if (
            detailsPayload &&
            typeof detailsPayload === 'object' &&
            Array.isArray((detailsPayload as { details?: unknown }).details)
          ) {
            error.details = (detailsPayload as { details: unknown }).details
          }
          throw error
        }
        setAddresses((prev) => {
          return prev.map((address) => {
            if (address.id !== id) {
              return payload.isPrimary ? { ...address, isPrimary: false } : address
            }
            return {
              ...address,
              name: payload.name ?? null,
              purpose: payload.purpose ?? null,
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
        flash(t('customers.people.detail.addresses.success'), 'success')
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [normalizedEntityId, pushLoading, popLoading, t, buildPayload]
  )

  const handleDelete = React.useCallback(
    async (id: string) => {
      if (!normalizedEntityId) {
        throw new Error(t('customers.people.detail.addresses.error'))
      }
      pushLoading()
      setIsSubmitting(true)
      try {
        const res = await apiFetch('/api/customers/addresses', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!res.ok) {
          let message = t('customers.people.detail.addresses.error')
          try {
            const details = await res.clone().json()
            if (details && typeof details.error === 'string') message = details.error
          } catch {}
          throw new Error(message)
        }
        setAddresses((prev) => prev.filter((address) => address.id !== id))
        flash(t('customers.people.detail.addresses.deleted'), 'success')
      } finally {
        setIsSubmitting(false)
        popLoading()
      }
    },
    [normalizedEntityId, pushLoading, popLoading, t]
  )

  const displayAddresses = React.useMemo<CustomerAddressValue[]>(() => {
    return addresses.map((address) => ({
      id: address.id,
      name: address.name ?? null,
      purpose: address.purpose ?? null,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      buildingNumber: address.buildingNumber ?? null,
      flatNumber: address.flatNumber ?? null,
      city: address.city ?? null,
      region: address.region ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
      isPrimary: address.isPrimary ?? false,
    }))
  }, [addresses])

  const handleAddActionChange = React.useCallback(
    (action: { openCreateForm: () => void; addDisabled: boolean } | null) => {
      if (!onActionChange) return
      if (!action) {
        onActionChange(null)
        return
      }
      onActionChange({
        label: addActionLabel,
        onClick: action.openCreateForm,
        disabled: action.addDisabled,
      })
    },
    [addActionLabel, onActionChange]
  )

  return (
    <div className="mt-4">
      <CustomerAddressTiles
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
      />
    </div>
  )
}

export default AddressesSection
