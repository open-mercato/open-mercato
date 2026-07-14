"use client"

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  createDictionaryMap,
  normalizeDictionaryEntries,
  type DictionaryDisplayEntry,
  type DictionaryMap,
} from '../dictionaryAppearance'
import { resolveDictionaryEntrySortMode, sortDictionaryEntries } from '../../lib/entrySort'

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

// The route caps entries per response, so a large dictionary needs several
// requests. Bound the walk so a server reporting hasMore forever cannot hang
// the caller; at the current 500-row ceiling this still covers 25k entries.
const DICTIONARY_ENTRIES_MAX_PAGES = 50

function parseDictionaryEntryItems(items: unknown[]): DictionaryEntryRecord[] {
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
  return parsed
}

async function fetchAllDictionaryEntryPages(
  dictionaryId: string,
): Promise<{ entries: DictionaryEntryRecord[]; sortMode: unknown; pageCount: number }> {
  const entries: DictionaryEntryRecord[] = []
  let sortMode: unknown = undefined
  let offset = 0
  let pageCount = 0

  while (pageCount < DICTIONARY_ENTRIES_MAX_PAGES) {
    // Omitting `limit` keeps the first request on the route's default page, the
    // only one it caches, and lets the server own the ceiling.
    const query = offset > 0 ? `?offset=${offset}` : ''
    const call = await apiCall<Record<string, unknown>>(
      `/api/dictionaries/${dictionaryId}/entries${query}`,
    )
    const payload = call.result ?? {}
    if (!call.ok) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : 'Failed to load dictionary entries.'
      throw new Error(message)
    }
    pageCount += 1
    if (sortMode === undefined) sortMode = payload.sortMode
    const items = Array.isArray(payload.items) ? payload.items : []
    entries.push(...parseDictionaryEntryItems(items))

    // An empty page also stops the walk: without it a server that keeps
    // reporting hasMore while returning nothing would spin to the page cap.
    if (payload.hasMore !== true || items.length === 0) break
    offset += items.length
  }

  return { entries, sortMode, pageCount }
}

export const dictionaryEntriesQueryOptions = (dictionaryId: string, scopeVersion = 0) => ({
  queryKey: dictionaryEntriesQueryKey(dictionaryId, scopeVersion),
  staleTime: DICTIONARY_ENTRIES_STALE_TIME,
  gcTime: DICTIONARY_ENTRIES_STALE_TIME,
  queryFn: async (): Promise<DictionaryEntriesQueryData> => {
    const pages = await fetchAllDictionaryEntryPages(dictionaryId)
    // The server bounds each response and orders it in memory, so entries
    // assembled from several pages are only sorted within each page. Re-apply
    // the mode that produced them across the whole set. A single-page
    // dictionary — every dictionary at or below the server ceiling — keeps the
    // server's ordering untouched.
    const parsed =
      pages.pageCount > 1
        ? sortDictionaryEntries(pages.entries, resolveDictionaryEntrySortMode(pages.sortMode))
        : pages.entries
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
