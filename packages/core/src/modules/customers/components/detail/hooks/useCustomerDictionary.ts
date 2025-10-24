"use client"

import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  createDictionaryMap,
  normalizeDictionaryEntries,
  type CustomerDictionaryDisplayEntry,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../lib/dictionaries'

export type CustomerDictionaryEntry = CustomerDictionaryDisplayEntry & {
  id: string
  organizationId: string | null
  isInherited: boolean
}

export type CustomerDictionaryQueryData = {
  entries: CustomerDictionaryDisplayEntry[]
  map: CustomerDictionaryMap
  fullEntries: CustomerDictionaryEntry[]
}

const DICTIONARY_STALE_TIME = 5 * 60 * 1000

const BASE_DICTIONARY_QUERY_KEY = ['customers', 'dictionaries'] as const

export const customerDictionaryQueryKey = (kind: CustomerDictionaryKind, scopeVersion = 0) =>
  [...BASE_DICTIONARY_QUERY_KEY, kind, `scope:${scopeVersion}`] as const

export const customerDictionaryQueryOptions = (kind: CustomerDictionaryKind, scopeVersion = 0) => ({
  queryKey: customerDictionaryQueryKey(kind, scopeVersion),
  staleTime: DICTIONARY_STALE_TIME,
  gcTime: DICTIONARY_STALE_TIME,
  queryFn: async (): Promise<CustomerDictionaryQueryData> => {
    const res = await apiFetch(`/api/customers/dictionaries/${kind}`)
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : 'Failed to load dictionary entries.'
      throw new Error(message)
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    const parsed = items
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const data = item as Record<string, unknown>
        const rawValue = typeof data.value === 'string' ? data.value.trim() : ''
        const id = typeof data.id === 'string' ? data.id : ''
        if (!rawValue || !id) return null
        const label =
          typeof data.label === 'string' && data.label.trim().length ? data.label.trim() : rawValue
        const color =
          typeof data.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(data.color)
            ? `#${data.color.slice(1).toLowerCase()}`
            : null
        const icon = typeof data.icon === 'string' && data.icon.trim().length ? data.icon.trim() : null
        const organizationId = typeof data.organizationId === 'string' ? data.organizationId : null
        const isInherited = data.isInherited === true
        return {
          id,
          value: rawValue,
          label,
          color,
          icon,
          organizationId,
          isInherited,
        }
      })
      .filter((entry): entry is CustomerDictionaryEntry => !!entry)
    const normalized = normalizeDictionaryEntries(
      parsed.map(({ value, label, color, icon }) => ({ value, label, color, icon })),
    )
    return {
      entries: normalized,
      map: createDictionaryMap(normalized),
      fullEntries: parsed,
    }
  },
})

export function useCustomerDictionary(
  kind: CustomerDictionaryKind,
  scopeVersion = 0,
): UseQueryResult<CustomerDictionaryQueryData> {
  return useQuery(customerDictionaryQueryOptions(kind, scopeVersion))
}

export async function invalidateCustomerDictionary(queryClient: QueryClient, kind: CustomerDictionaryKind) {
  await queryClient.invalidateQueries({ queryKey: [...BASE_DICTIONARY_QUERY_KEY, kind] })
}

export async function ensureCustomerDictionary(
  queryClient: QueryClient,
  kind: CustomerDictionaryKind,
  scopeVersion = 0,
): Promise<CustomerDictionaryQueryData> {
  return queryClient.fetchQuery(customerDictionaryQueryOptions(kind, scopeVersion))
}
