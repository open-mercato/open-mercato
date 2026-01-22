"use client"

import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { AddressDataAdapter } from '@open-mercato/ui/backend/detail'
import type { AddressTypesAdapter } from '@open-mercato/ui/backend/detail'
import { loadStaffDictionaryEntries, createStaffDictionaryEntry } from './dictionaries'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

type ApiAddressPayload = Record<string, unknown>

export function createStaffAddressAdapter(translator: Translator): AddressDataAdapter {
  return {
    list: async ({ entityId }) => {
      if (!entityId) return []
      const params = new URLSearchParams({ entityId, pageSize: '100' })
      const payload = await readApiResultOrThrow<ApiAddressPayload>(
        `/api/staff/addresses?${params.toString()}`,
        undefined,
        { errorMessage: translator('staff.teamMembers.detail.addresses.error', 'Failed to load addresses.') },
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
    create: async ({ entityId, payload }) => {
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/staff/addresses',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId,
            ...payload,
            country: payload.country ? payload.country.toUpperCase() : undefined,
          }),
        },
        { errorMessage: translator('staff.teamMembers.detail.addresses.error', 'Failed to save address.') },
      )
      return response.result ?? {}
    },
    update: async ({ id, payload }) => {
      await apiCallOrThrow(
        '/api/staff/addresses',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id,
            ...payload,
            country: payload.country ? payload.country.toUpperCase() : undefined,
          }),
        },
        { errorMessage: translator('staff.teamMembers.detail.addresses.error', 'Failed to save address.') },
      )
    },
    delete: async ({ id }) => {
      await apiCallOrThrow(
        '/api/staff/addresses',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        },
        { errorMessage: translator('staff.teamMembers.detail.addresses.error', 'Failed to delete address.') },
      )
    },
  }
}

export function createStaffAddressTypesAdapter(translator: Translator): AddressTypesAdapter {
  return {
    list: async () => {
      const entries = await loadStaffDictionaryEntries('addressTypes')
      return entries.map((entry) => ({ value: entry.value, label: entry.label }))
    },
    create: async (value: string) => {
      const entry = await createStaffDictionaryEntry('addressTypes', { value })
      if (!entry) return null
      return { value: entry.value, label: entry.label }
    },
    manageHref: '/backend/config/dictionaries',
  }
}
