"use client"

import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type DictionaryEntryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

type DictionarySummary = {
  id: string
  key: string
  name: string
}

const STAFF_DICTIONARY_KEYS = {
  activityTypes: 'staff-activity-types',
  addressTypes: 'staff-address-types',
} as const

const STAFF_ADDRESS_TYPE_DEFAULTS = [
  { value: 'home address', label: 'Home address' },
  { value: 'mailing address', label: 'Mailing address' },
  { value: 'job address', label: 'Job address' },
]

function parseDictionaryEntries(items: Record<string, unknown>[]): DictionaryEntryOption[] {
  return items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const value = typeof record.value === 'string' ? record.value : null
      if (!value) return null
      const label = typeof record.label === 'string' && record.label.trim().length ? record.label : value
      const color = typeof record.color === 'string' ? record.color : null
      const icon = typeof record.icon === 'string' ? record.icon : null
      return { value, label, color, icon }
    })
    .filter((entry): entry is DictionaryEntryOption => !!entry)
}

async function ensureDictionaryDefaults(
  dictionaryId: string,
  entries: DictionaryEntryOption[],
  defaults: Array<{ value: string; label: string }>,
): Promise<DictionaryEntryOption[]> {
  const existingValues = new Set(entries.map((entry) => entry.value.toLowerCase()))
  const missing = defaults.filter((entry) => !existingValues.has(entry.value.toLowerCase()))
  if (!missing.length) return entries
  await Promise.all(
    missing.map((entry) =>
      apiCall(`/api/dictionaries/${dictionaryId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: entry.value, label: entry.label }),
      }),
    ),
  )
  const entriesCall = await apiCall<{ items?: Record<string, unknown>[] }>(`/api/dictionaries/${dictionaryId}/entries`)
  const items = Array.isArray(entriesCall.result?.items) ? entriesCall.result?.items ?? [] : []
  return parseDictionaryEntries(items)
}

async function ensureDictionary(key: string, name: string): Promise<DictionarySummary | null> {
  const listCall = await apiCall<{ items?: DictionarySummary[] }>('/api/dictionaries')
  const items = Array.isArray(listCall.result?.items) ? listCall.result?.items ?? [] : []
  const existing = items.find((item) => item && item.key === key)
  if (existing) return existing
  if (!listCall.ok) return null
  const created = await apiCallOrThrow<DictionarySummary>(
    '/api/dictionaries',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, name }),
    },
  )
  const result = created.result as DictionarySummary | undefined
  if (result && result.id && result.key) return result
  return null
}

export async function loadStaffDictionaryEntries(kind: keyof typeof STAFF_DICTIONARY_KEYS): Promise<DictionaryEntryOption[]> {
  const { entries } = await loadStaffDictionary(kind)
  return entries
}

export async function loadStaffDictionary(
  kind: keyof typeof STAFF_DICTIONARY_KEYS,
): Promise<{ dictionary: DictionarySummary | null; entries: DictionaryEntryOption[] }> {
  const key = STAFF_DICTIONARY_KEYS[kind]
  const name = kind === 'activityTypes' ? 'Staff activity types' : 'Staff address types'
  const dictionary = await ensureDictionary(key, name)
  if (!dictionary) return { dictionary: null, entries: [] }
  const entriesCall = await apiCall<{ items?: Record<string, unknown>[] }>(`/api/dictionaries/${dictionary.id}/entries`)
  if (!entriesCall.ok) return { dictionary, entries: [] }
  const items = Array.isArray(entriesCall.result?.items) ? entriesCall.result?.items ?? [] : []
  const entries = parseDictionaryEntries(items)
  if (kind === 'addressTypes') {
    const defaultEntries = await ensureDictionaryDefaults(dictionary.id, entries, STAFF_ADDRESS_TYPE_DEFAULTS)
    return { dictionary, entries: defaultEntries }
  }
  return { dictionary, entries }
}

export async function createStaffDictionaryEntry(
  kind: keyof typeof STAFF_DICTIONARY_KEYS,
  input: { value: string; label?: string; color?: string | null; icon?: string | null },
): Promise<DictionaryEntryOption | null> {
  const key = STAFF_DICTIONARY_KEYS[kind]
  const name = kind === 'activityTypes' ? 'Staff activity types' : 'Staff address types'
  const dictionary = await ensureDictionary(key, name)
  if (!dictionary) return null
  const response = await apiCallOrThrow<Record<string, unknown>>(
    `/api/dictionaries/${dictionary.id}/entries`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: input.value,
        label: input.label ?? undefined,
        color: input.color ?? undefined,
        icon: input.icon ?? undefined,
      }),
    },
  )
  const payload = response.result ?? {}
  const value = typeof payload.value === 'string' && payload.value.trim().length ? payload.value : input.value
  const label = typeof payload.label === 'string' && payload.label.trim().length ? payload.label : value
  const color = typeof payload.color === 'string' ? payload.color : input.color ?? null
  const icon = typeof payload.icon === 'string' ? payload.icon : input.icon ?? null
  return { value, label, color, icon }
}
