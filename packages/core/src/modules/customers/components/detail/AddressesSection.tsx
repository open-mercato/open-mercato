"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import { CustomerAddressTiles, type CustomerAddressInput, type CustomerAddressValue } from '../AddressTiles'
import type { AddressSummary, SectionAction, TabEmptyStateConfig, Translator } from './types'
import { useT } from '@/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type AddressesSectionProps = {
  entityId: string | null
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyStateConfig
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
    companyName: readString(record, 'company_name', 'companyName'),
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
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const t = translator ?? fallbackTranslator

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
      const params = new URLSearchParams({ entityId: normalizedEntityId, pageSize: '100' })
      const payload = await readApiResultOrThrow<ApiAddressPayload>(
        `/api/customers/addresses?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.people.detail.addresses.error') },
      )
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
      setIsLoading(false)
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
        if (typeof payload.companyName === 'string') bodyPayload.companyName = payload.companyName
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
        const response = await apiCallOrThrow<Record<string, unknown>>(
          '/api/customers/addresses',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload({})(payload)),
          },
          { errorMessage: t('customers.people.detail.addresses.error') },
        )
        const body = response.result ?? {}
        const newAddress: AddressSummary = {
          id: typeof body?.id === 'string' ? body.id : generateTempId(),
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
        flash(t('customers.people.detail.addresses.success'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : t('customers.people.detail.addresses.error')
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
        await apiCallOrThrow(
          '/api/customers/addresses',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload({ id })(payload)),
          },
          { errorMessage: t('customers.people.detail.addresses.error') },
        )
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
        flash(t('customers.people.detail.addresses.success'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : t('customers.people.detail.addresses.error')
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
      await apiCallOrThrow(
        '/api/customers/addresses',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        },
        { errorMessage: t('customers.people.detail.addresses.error') },
      )
      setAddresses((prev) => prev.filter((address) => address.id !== id))
      flash(t('customers.people.detail.addresses.deleted'), 'success')
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : t('customers.people.detail.addresses.error')
      flash(message, 'error')
      throw err
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
      {isLoading ? (
        <div className="flex justify-center">
          <LoadingMessage
            label={t('customers.people.detail.addresses.loading', 'Loading addresses…')}
            className="min-h-[120px] w-full justify-center border-0 bg-transparent p-0"
          />
        </div>
      ) : (
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
      )}
    </div>
  )
}

export default AddressesSection
