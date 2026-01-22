"use client"

import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  resolveUnavailabilityReasonDictionary,
  type UnavailabilityReasonSubjectType,
} from '@open-mercato/core/modules/planner/lib/unavailabilityReasons'

export type UnavailabilityReasonEntry = {
  id: string
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

export async function loadUnavailabilityReasonEntries(
  subjectType: UnavailabilityReasonSubjectType,
): Promise<UnavailabilityReasonEntry[]> {
  const dictionary = resolveUnavailabilityReasonDictionary(subjectType)
  const resolved = await ensureDictionary(dictionary.key, dictionary.name)
  if (!resolved) return []
  const entriesCall = await apiCall<{ items?: Record<string, unknown>[] }>(`/api/dictionaries/${resolved.id}/entries`)
  if (!entriesCall.ok) return []
  const items = Array.isArray(entriesCall.result?.items) ? entriesCall.result?.items ?? [] : []
  return items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : null
      const value = typeof record.value === 'string' ? record.value : null
      if (!id || !value) return null
      const label = typeof record.label === 'string' && record.label.trim().length ? record.label : value
      const color = typeof record.color === 'string' ? record.color : null
      const icon = typeof record.icon === 'string' ? record.icon : null
      return { id, value, label, color, icon }
    })
    .filter((entry): entry is UnavailabilityReasonEntry => !!entry)
}

export async function createUnavailabilityReasonEntry(
  subjectType: UnavailabilityReasonSubjectType,
  input: { value: string; label?: string; color?: string | null; icon?: string | null },
): Promise<UnavailabilityReasonEntry | null> {
  const dictionary = resolveUnavailabilityReasonDictionary(subjectType)
  const resolved = await ensureDictionary(dictionary.key, dictionary.name)
  if (!resolved) return null
  const response = await apiCallOrThrow<Record<string, unknown>>(
    `/api/dictionaries/${resolved.id}/entries`,
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
  const id = typeof payload.id === 'string' ? payload.id : null
  const value = typeof payload.value === 'string' && payload.value.trim().length ? payload.value : input.value
  const label = typeof payload.label === 'string' && payload.label.trim().length ? payload.label : value
  const color = typeof payload.color === 'string' ? payload.color : input.color ?? null
  const icon = typeof payload.icon === 'string' ? payload.icon : input.icon ?? null
  if (!id) return null
  return { id, value, label, color, icon }
}
