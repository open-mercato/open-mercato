"use client"

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { QueryClient } from '@tanstack/react-query'
import * as React from 'react'

export type CurrencyDictionaryEntry = {
  id: string
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

export type CurrencyDictionaryPayload = {
  id: string
  entries: CurrencyDictionaryEntry[]
}

const QUERY_KEY = ['customers', 'dictionaries', 'currency'] as const
const STALE_TIME = 5 * 60 * 1000

const cache = new Map<string, { promise: Promise<CurrencyDictionaryPayload>; client: QueryClient }>()
const CACHE_KEY = JSON.stringify(QUERY_KEY)

async function fetchCurrencyDictionary(): Promise<CurrencyDictionaryPayload> {
  const payload = await readApiResultOrThrow<Record<string, unknown>>(
    '/api/customers/dictionaries/currency',
    undefined,
    { errorMessage: 'Failed to load currency dictionary.' },
  )
  const id = typeof payload?.id === 'string' ? payload.id : ''
  if (!id) {
    throw new Error('Currency dictionary is not configured yet.')
  }
  const entriesRaw = Array.isArray(payload?.entries) ? payload.entries : []
  const entries: CurrencyDictionaryEntry[] = entriesRaw
    .map((entry: any): CurrencyDictionaryEntry | null => {
      const value = typeof entry?.value === 'string' ? entry.value.trim().toUpperCase() : ''
      const label =
        typeof entry?.label === 'string' && entry.label.trim().length
          ? entry.label.trim()
          : value
      const entryId = typeof entry?.id === 'string' ? entry.id : value
      if (!value) return null
      const color = typeof entry?.color === 'string' && entry.color.trim().length ? entry.color.trim() : null
      const icon = typeof entry?.icon === 'string' && entry.icon.trim().length ? entry.icon.trim() : null
      return { id: entryId, value, label, color, icon }
    })
    .filter((entry: CurrencyDictionaryEntry | null): entry is CurrencyDictionaryEntry => entry !== null)
  return { id, entries }
}

export function useCurrencyDictionary() {
  const [, forceRender] = React.useReducer((c) => c + 1, 0)
  const entry = cache.get(CACHE_KEY)
  const result = entry?.client.getQueryState<CurrencyDictionaryPayload>(QUERY_KEY)

  React.useEffect(() => {
    if (entry?.client.getQueryData(QUERY_KEY)) {
      forceRender()
      return
    }
    const client = entry?.client ?? new QueryClient()
    const promise = entry?.promise ?? client.fetchQuery({ queryKey: QUERY_KEY, queryFn: fetchCurrencyDictionary, staleTime: STALE_TIME, gcTime: STALE_TIME })
    if (!entry) cache.set(CACHE_KEY, { promise, client })
    promise.finally(() => { forceRender() })
  }, [])

  const data = entry?.client.getQueryData<CurrencyDictionaryPayload>(QUERY_KEY) ?? null
  const isLoading = !data && !(result && (result as any).status === 'error')
  const error = (result && (result as any).status === 'error') ? (result as any).error ?? null : null
  const refetch = React.useCallback(async () => {
    const current = cache.get(CACHE_KEY)
    const client = current?.client ?? new QueryClient()
    const promise = client.fetchQuery({ queryKey: QUERY_KEY, queryFn: fetchCurrencyDictionary, staleTime: STALE_TIME, gcTime: STALE_TIME })
    cache.set(CACHE_KEY, { promise, client })
    const payload = await promise
    forceRender()
    return payload
  }, [])
  return { data, error, isLoading, isError: Boolean(error), refetch }
}

export async function ensureCurrencyDictionary(queryClient: QueryClient) {
  const key = JSON.stringify(QUERY_KEY)
  const existing = cache.get(key)
  if (existing) return existing.promise
  const promise = queryClient.fetchQuery({ queryKey: QUERY_KEY, queryFn: fetchCurrencyDictionary, staleTime: STALE_TIME, gcTime: STALE_TIME })
  cache.set(key, { promise, client: queryClient })
  return promise
}
