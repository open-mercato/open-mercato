"use client"

import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQuery, type QueryClient } from '@tanstack/react-query'

export type CurrencyDictionaryEntry = {
  id: string
  value: string
  label: string
}

export type CurrencyDictionaryPayload = {
  id: string
  entries: CurrencyDictionaryEntry[]
}

const QUERY_KEY = ['customers', 'dictionaries', 'currency'] as const
const STALE_TIME = 5 * 60 * 1000

const currencyDictionaryQueryOptions = (options?: { enabled?: boolean }) => ({
  queryKey: QUERY_KEY,
  staleTime: STALE_TIME,
  gcTime: STALE_TIME,
  queryFn: async (): Promise<CurrencyDictionaryPayload> => {
    const res = await apiFetch('/api/customers/dictionaries/currency')
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message =
        typeof payload?.error === 'string'
          ? payload.error
          : 'Failed to load currency dictionary.'
      throw new Error(message)
    }
    const id = typeof payload?.id === 'string' ? payload.id : ''
    if (!id) {
      throw new Error('Currency dictionary is not configured yet.')
    }
    const entriesRaw = Array.isArray(payload?.entries) ? payload.entries : []
    const entries: CurrencyDictionaryEntry[] = entriesRaw
      .map((entry: any) => {
        const value = typeof entry?.value === 'string' ? entry.value.trim().toUpperCase() : ''
        const label =
          typeof entry?.label === 'string' && entry.label.trim().length
            ? entry.label.trim()
            : value
        const entryId = typeof entry?.id === 'string' ? entry.id : value
        if (!value) return null
        return { id: entryId, value, label }
      })
      .filter((entry): entry is CurrencyDictionaryEntry => !!entry)
    return { id, entries }
  },
  enabled: options?.enabled !== false,
})

export function useCurrencyDictionary(options?: { enabled?: boolean }) {
  return useQuery(currencyDictionaryQueryOptions(options))
}

export async function ensureCurrencyDictionary(queryClient: QueryClient) {
  return queryClient.ensureQueryData(currencyDictionaryQueryOptions())
}
