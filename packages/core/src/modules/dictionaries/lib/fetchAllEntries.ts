"use client"

import { fetchAllOffsetPages } from '@open-mercato/ui/backend/utils/fetchAllPages'
import {
  resolveDictionaryEntrySortMode,
  sortDictionaryEntries,
  type DictionaryEntrySortItem,
} from './entrySort'

export type DictionaryEntryItem = Record<string, unknown>

export type DictionaryEntriesResult = {
  ok: boolean
  items: DictionaryEntryItem[]
  pageCount: number
  errorMessage: string | null
}

type DictionaryEntrySortView = DictionaryEntrySortItem & { entry: DictionaryEntryItem }

function toRecords(items: unknown[]): DictionaryEntryItem[] {
  return items.filter((item): item is DictionaryEntryItem => !!item && typeof item === 'object')
}

function toSortView(entry: DictionaryEntryItem): DictionaryEntrySortView {
  const value = typeof entry.value === 'string' ? entry.value.trim() : ''
  const label = typeof entry.label === 'string' ? entry.label.trim() : ''
  return {
    entry,
    id: typeof entry.id === 'string' ? entry.id : null,
    value: value.length ? value : null,
    label: label.length ? label : null,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
  }
}

/**
 * Load every entry of a dictionary, walking the entries route's page cap.
 *
 * The route bounds each response, so any consumer that needs the full option
 * list must page — reading `items` from a single request silently drops
 * everything past the ceiling and makes those values unselectable.
 */
export async function fetchAllDictionaryEntries(
  dictionaryId: string,
): Promise<DictionaryEntriesResult> {
  const pages = await fetchAllOffsetPages(`/api/dictionaries/${dictionaryId}/entries`)
  const records = toRecords(pages.items)

  if (!pages.ok) {
    const error = pages.errorPayload?.error
    return {
      ok: false,
      items: records,
      pageCount: pages.pageCount,
      errorMessage: typeof error === 'string' ? error : null,
    }
  }

  // The route bounds each response and orders it in memory, so entries
  // assembled from several pages are only sorted within each page. Re-apply the
  // mode that produced them across the whole set. A single-page dictionary —
  // every dictionary at or below the route ceiling — keeps the server ordering
  // byte-for-byte.
  if (pages.pageCount <= 1) {
    return { ok: true, items: records, pageCount: pages.pageCount, errorMessage: null }
  }

  const sortMode = resolveDictionaryEntrySortMode(pages.firstPayload.sortMode)
  const sorted = sortDictionaryEntries(records.map(toSortView), sortMode).map((view) => view.entry)
  return { ok: true, items: sorted, pageCount: pages.pageCount, errorMessage: null }
}
