"use client"

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type DictionarySummary = {
  id: string
  key: string
}

export type DictionaryEntryOption = {
  id: string
  value: string
  label: string
  color: string | null
  icon: string | null
}

function normalizeDictionaryList(items: unknown): DictionarySummary[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : null
      const key = typeof record.key === 'string' ? record.key : null
      if (!id || !key) return null
      return { id, key }
    })
    .filter((item): item is DictionarySummary => !!item)
}

function normalizeDictionaryEntries(items: unknown): DictionaryEntryOption[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : null
      const value = typeof record.value === 'string' ? record.value : null
      if (!id || !value) return null
      return {
        id,
        value,
        label:
          typeof record.label === 'string' && record.label.trim().length > 0
            ? record.label
            : value,
        color: typeof record.color === 'string' ? record.color : null,
        icon: typeof record.icon === 'string' ? record.icon : null,
      }
    })
    .filter((item): item is DictionaryEntryOption => !!item)
}

export async function loadDictionaryEntriesByKey(key: string): Promise<DictionaryEntryOption[]> {
  const dictionariesCall = await apiCall<{ items?: unknown[] }>('/api/dictionaries')
  if (!dictionariesCall.ok) return []

  const dictionary = normalizeDictionaryList(dictionariesCall.result?.items).find((item) => item.key === key)
  if (!dictionary) return []

  const entriesCall = await apiCall<{ items?: unknown[] }>(`/api/dictionaries/${dictionary.id}/entries`)
  if (!entriesCall.ok) return []

  return normalizeDictionaryEntries(entriesCall.result?.items)
}
