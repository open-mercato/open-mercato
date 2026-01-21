"use client"

import * as React from 'react'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { AddressesSection as SharedAddressesSection } from '@open-mercato/ui/backend/detail'
import type { AddressDataAdapter } from '@open-mercato/ui/backend/detail'
import type { AddressTypesAdapter } from '@open-mercato/ui/backend/detail'
import type { AddressFormatStrategy } from '@open-mercato/ui/backend/detail'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type AddressesSectionProps = {
  entityId: string | null
  emptyLabel: string
  addActionLabel: string
  emptyState: { title: string; actionLabel: string; description?: string }
  onActionChange?: (action: { label: string; onClick: () => void; disabled?: boolean } | null) => void
  translator?: (key: string, fallback?: string, params?: Record<string, string | number>) => string
  onLoadingChange?: (isLoading: boolean) => void
}

type ApiAddressPayload = Record<string, unknown>

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
  const fallbackTranslator = React.useMemo(() => createTranslatorWithFallback(tHook), [tHook])
  const t = translator ?? fallbackTranslator

  const dataAdapter = React.useMemo<AddressDataAdapter>(() => ({
    list: async ({ entityId: listEntityId }) => {
      if (!listEntityId) return []
      const params = new URLSearchParams({ entityId: listEntityId, pageSize: '100' })
      const payload = await readApiResultOrThrow<ApiAddressPayload>(
        `/api/customers/addresses?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.people.detail.addresses.error') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          const rawId = record.id ?? record.address_id ?? null
          const id =
            typeof rawId === 'string'
              ? rawId
              : typeof rawId === 'number' || typeof rawId === 'bigint'
                ? String(rawId)
                : null
          if (!id) return null
          const addressLine1 = typeof record.address_line1 === 'string'
            ? record.address_line1
            : typeof record.addressLine1 === 'string'
              ? record.addressLine1
              : null
          if (!addressLine1) return null
          return {
            id,
            name: typeof record.name === 'string' ? record.name : null,
            purpose: typeof record.purpose === 'string' ? record.purpose : null,
            companyName: typeof record.company_name === 'string'
              ? record.company_name
              : typeof record.companyName === 'string'
                ? record.companyName
                : null,
            addressLine1,
            addressLine2: typeof record.address_line2 === 'string'
              ? record.address_line2
              : typeof record.addressLine2 === 'string'
                ? record.addressLine2
                : null,
            buildingNumber: typeof record.building_number === 'string'
              ? record.building_number
              : typeof record.buildingNumber === 'string'
                ? record.buildingNumber
                : null,
            flatNumber: typeof record.flat_number === 'string'
              ? record.flat_number
              : typeof record.flatNumber === 'string'
                ? record.flatNumber
                : null,
            city: typeof record.city === 'string' ? record.city : null,
            region: typeof record.region === 'string' ? record.region : null,
            postalCode: typeof record.postal_code === 'string'
              ? record.postal_code
              : typeof record.postalCode === 'string'
                ? record.postalCode
                : null,
            country: typeof record.country === 'string' ? record.country : null,
            isPrimary:
              typeof record.is_primary === 'boolean'
                ? record.is_primary
                : typeof record.isPrimary === 'boolean'
                  ? record.isPrimary
                  : false,
          }
        })
        .filter((value): value is NonNullable<typeof value> => value !== null)
    },
    create: async ({ entityId: targetId, payload }) => {
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/customers/addresses',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId: targetId,
            ...payload,
            country: payload.country ? payload.country.toUpperCase() : undefined,
          }),
        },
        { errorMessage: t('customers.people.detail.addresses.error') },
      )
      return response.result ?? {}
    },
    update: async ({ id, payload }) => {
      await apiCallOrThrow(
        '/api/customers/addresses',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id,
            ...payload,
            country: payload.country ? payload.country.toUpperCase() : undefined,
          }),
        },
        { errorMessage: t('customers.people.detail.addresses.error') },
      )
    },
    delete: async ({ id }) => {
      await apiCallOrThrow(
        '/api/customers/addresses',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        },
        { errorMessage: t('customers.people.detail.addresses.error') },
      )
    },
  }), [t])

  const addressTypesAdapter = React.useMemo<AddressTypesAdapter>(() => ({
    list: async () => {
      const call = await apiCall<Record<string, unknown>>('/api/customers/dictionaries/address-types', {
        method: 'GET',
      })
      const payload = call.result ?? {}
      const items = Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items?: unknown[] }).items
        : []
      return items
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          const value = typeof record.value === 'string' ? record.value : null
          if (!value) return null
          const label = typeof record.label === 'string' && record.label.trim().length ? record.label : value
          return { value, label }
        })
        .filter((entry): entry is { value: string; label: string } => !!entry)
    },
    create: async (value: string) => {
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/customers/dictionaries/address-types',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value }),
        },
        { errorMessage: t('customers.people.detail.addresses.types.saveError', 'Failed to save address type') },
      )
      const payload = response.result ?? {}
      const createdValue = typeof payload.value === 'string' ? payload.value : value
      const label = typeof payload.label === 'string' && payload.label.trim().length ? payload.label : createdValue
      return { value: createdValue, label }
    },
    manageHref: '/backend/config/customers',
  }), [t])

  const loadFormat = React.useCallback(async (): Promise<AddressFormatStrategy> => {
    const call = await apiCall<{ addressFormat?: string; error?: string }>(
      '/api/customers/settings/address-format',
    )
    const payload = (call.result ?? {}) as Record<string, unknown>
    if (!call.ok) {
      const message =
        typeof (payload as Record<string, unknown>)?.error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : t('customers.people.detail.addresses.formatLoadError', 'Failed to load address configuration')
      throw new Error(message)
    }
    const valueRaw = payload?.addressFormat
    const value = typeof valueRaw === 'string' ? valueRaw : null
    if (value === 'street_first' || value === 'line_first') {
      return value
    }
    return 'line_first'
  }, [t])

  return (
    <SharedAddressesSection
      entityId={entityId}
      emptyLabel={emptyLabel}
      addActionLabel={addActionLabel}
      emptyState={emptyState}
      onActionChange={onActionChange}
      onLoadingChange={onLoadingChange}
      translator={t}
      dataAdapter={dataAdapter}
      addressTypesAdapter={addressTypesAdapter}
      loadFormat={loadFormat}
    />
  )
}

export default AddressesSection
