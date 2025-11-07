"use client"

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  createDictionaryMap,
  normalizeDictionaryEntries,
  type DictionaryDisplayEntry,
  type DictionaryMap,
} from '../dictionaryAppearance'

export type DictionaryEntryRecord = DictionaryDisplayEntry & {
  id: string
  createdAt: string | null
  updatedAt: string | null
}

export type DictionaryEntriesQueryData = {
  entries: DictionaryDisplayEntry[]
  map: DictionaryMap
  fullEntries: DictionaryEntryRecord[]
}

const DICTIONARY_ENTRIES_STALE_TIME = 5 * 60 * 1000

const BASE_DICTIONARY_ENTRIES_KEY = ['dictionaries', 'entries'] as const

export const dictionaryEntriesQueryKey = (dictionaryId: string, scopeVersion = 0) =>
  [...BASE_DICTIONARY_ENTRIES_KEY, dictionaryId, `scope:${scopeVersion}`] as const

export const dictionaryEntriesQueryOptions = (dictionaryId: string, scopeVersion = 0) => ({
  queryKey: dictionaryEntriesQueryKey(dictionaryId, scopeVersion),
  staleTime: DICTIONARY_ENTRIES_STALE_TIME,
  gcTime: DICTIONARY_ENTRIES_STALE_TIME,
  queryFn: async (): Promise<DictionaryEntriesQueryData> => {
    const call = await apiCall<Record<string, unknown>>(`/api/dictionaries/${dictionaryId}/entries`)
    const payload = call.result ?? {}
    if (!call.ok) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : 'Failed to load dictionary entries.'
      throw new Error(message)
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    const parsed: DictionaryEntryRecord[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const data = item as Record<string, unknown>
      const id = typeof data.id === 'string' ? data.id : ''
      const value = typeof data.value === 'string' ? data.value.trim() : ''
      if (!id || !value) continue
      const label =
        typeof data.label === 'string' && data.label.trim().length ? data.label.trim() : value
      const color =
        typeof data.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(data.color)
          ? `#${data.color.slice(1).toLowerCase()}`
          : null
      const icon = typeof data.icon === 'string' && data.icon.trim().length ? data.icon.trim() : null
      const createdAt = typeof data.createdAt === 'string' ? data.createdAt : null
      const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null
      parsed.push({
        id,
        value,
        label,
        color,
        icon,
        createdAt,
        updatedAt,
      })
    }
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

export function useDictionaryEntries(
  dictionaryId: string,
  scopeVersion = 0,
): UseQueryResult<DictionaryEntriesQueryData> {
  return useQuery(dictionaryEntriesQueryOptions(dictionaryId, scopeVersion))
}

export async function invalidateDictionaryEntries(queryClient: QueryClient, dictionaryId: string) {
  await queryClient.invalidateQueries({ queryKey: [...BASE_DICTIONARY_ENTRIES_KEY, dictionaryId] })
}

export async function ensureDictionaryEntries(
  queryClient: QueryClient,
  dictionaryId: string,
  scopeVersion = 0,
): Promise<DictionaryEntriesQueryData> {
  return queryClient.ensureQueryData(dictionaryEntriesQueryOptions(dictionaryId, scopeVersion))
}
