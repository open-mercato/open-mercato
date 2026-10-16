"use client"

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
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

function resolveDictionaryLocale(): string {
  return typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en'
}

export const customerDictionaryQueryKey = (kind: CustomerDictionaryKind, scopeVersion = 0, organizationId?: string | null, locale = resolveDictionaryLocale()) =>
  [...BASE_DICTIONARY_QUERY_KEY, kind, `scope:${scopeVersion}`, organizationId ? `org:${organizationId}` : 'org:default', `locale:${locale}`] as const

export const customerDictionaryQueryOptions = (kind: CustomerDictionaryKind, scopeVersion = 0, organizationId?: string | null, locale = resolveDictionaryLocale()) => ({
  queryKey: customerDictionaryQueryKey(kind, scopeVersion, organizationId, locale),
  staleTime: DICTIONARY_STALE_TIME,
  gcTime: DICTIONARY_STALE_TIME,
  queryFn: async (): Promise<CustomerDictionaryQueryData> => {
    const params = new URLSearchParams({ locale })
    if (organizationId) params.set('organizationId', organizationId)
    const url = `/api/customers/dictionaries/${kind}?${params}`
    const payload = await readApiResultOrThrow<Record<string, unknown>>(
      url,
      undefined,
      { errorMessage: 'Failed to load dictionary entries.' },
    )
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
        } as CustomerDictionaryEntry
      })
      .filter((entry): entry is CustomerDictionaryEntry => entry !== null)
    const normalized = normalizeDictionaryEntries(
      parsed.map(({ value, label, color, icon }) => ({ value, label, color, icon })),
      { sort: false },
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
  organizationId?: string | null,
): UseQueryResult<CustomerDictionaryQueryData> {
  const locale = useOptionalLocale()
  return useQuery(customerDictionaryQueryOptions(kind, scopeVersion, organizationId, locale))
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
