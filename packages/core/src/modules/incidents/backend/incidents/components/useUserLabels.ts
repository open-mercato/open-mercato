"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type AuthUserOption = {
  id: string
  label: string
  name: string | null
  email: string | null
}

type AuthUserRecord = {
  id?: string | null
  name?: string | null
  email?: string | null
}

type AuthUsersResponse = {
  items?: AuthUserRecord[]
}

type CachedUserLabel = {
  label: string
  status: 'ok' | 'forbidden' | 'error'
}

export type UserLabelLookupResult = {
  label: string
  status: CachedUserLabel['status']
}

export type UserSearchResult =
  | { status: 'ok'; options: AuthUserOption[] }
  | { status: 'forbidden'; options: [] }
  | { status: 'error'; options: [] }

const MAX_LABEL_LOOKUPS = 25
const userLabelCache = new Map<string, CachedUserLabel>()
const pendingUserLabelLookups = new Map<string, Promise<UserLabelLookupResult>>()

function cleanText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function formatUserLabel(id: string, name: string | null, email: string | null): string {
  if (name && email) return `${name} (${email})`
  return name ?? email ?? id
}

function normalizeUserRecord(record: AuthUserRecord): AuthUserOption | null {
  const id = cleanText(record.id)
  if (!id) return null
  const name = cleanText(record.name)
  const email = cleanText(record.email)
  return {
    id,
    name,
    email,
    label: formatUserLabel(id, name, email),
  }
}

function cacheUserOption(option: AuthUserOption): void {
  userLabelCache.set(option.id, { label: option.label, status: 'ok' })
}

function cacheFallback(id: string, status: 'forbidden' | 'error'): UserLabelLookupResult {
  const result = { label: id, status }
  userLabelCache.set(id, result)
  return result
}

export async function searchAuthUsers(query: string): Promise<UserSearchResult> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', '25')
  const trimmed = query.trim()
  if (trimmed.length > 0) params.set('name', trimmed)

  const call = await apiCall<AuthUsersResponse>(`/api/auth/users?${params.toString()}`)
  if (call.status === 403) return { status: 'forbidden', options: [] }
  if (!call.ok || !call.result) return { status: 'error', options: [] }

  const options = (call.result.items ?? [])
    .map(normalizeUserRecord)
    .filter((option): option is AuthUserOption => option !== null)
  options.forEach(cacheUserOption)
  return { status: 'ok', options }
}

export async function lookupUserLabel(id: string): Promise<UserLabelLookupResult> {
  const normalizedId = id.trim()
  const cached = userLabelCache.get(normalizedId)
  if (cached) return cached

  const pending = pendingUserLabelLookups.get(normalizedId)
  if (pending) return pending

  const request = (async (): Promise<UserLabelLookupResult> => {
    const params = new URLSearchParams()
    params.set('id', normalizedId)
    params.set('page', '1')
    params.set('pageSize', '1')

    const call = await apiCall<AuthUsersResponse>(`/api/auth/users?${params.toString()}`)
    if (call.status === 403) return cacheFallback(normalizedId, 'forbidden')
    if (!call.ok || !call.result) return cacheFallback(normalizedId, 'error')

    const option = (call.result.items ?? [])
      .map(normalizeUserRecord)
      .find((item): item is AuthUserOption => item?.id === normalizedId)
    if (!option) return cacheFallback(normalizedId, 'error')

    cacheUserOption(option)
    return { label: option.label, status: 'ok' }
  })().finally(() => {
    pendingUserLabelLookups.delete(normalizedId)
  })

  pendingUserLabelLookups.set(normalizedId, request)
  return request
}

export function useUserLabels(ids: readonly string[]): Record<string, string> {
  const idsKey = React.useMemo(() => {
    const unique = Array.from(new Set(
      ids
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ))
    return unique.slice(0, MAX_LABEL_LOOKUPS).join('|')
  }, [ids])

  const [labels, setLabels] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    const normalizedIds = idsKey ? idsKey.split('|') : []
    if (normalizedIds.length === 0) {
      setLabels({})
      return
    }

    const nextLabels: Record<string, string> = {}
    const missing: string[] = []
    for (const id of normalizedIds) {
      const cached = userLabelCache.get(id)
      nextLabels[id] = cached?.label ?? id
      if (!cached) missing.push(id)
    }
    setLabels(nextLabels)

    if (missing.length === 0) return

    let cancelled = false
    Promise.all(missing.map((id) => lookupUserLabel(id)))
      .then(() => {
        if (cancelled) return
        setLabels((current) => {
          const updated = { ...current }
          for (const id of normalizedIds) {
            updated[id] = userLabelCache.get(id)?.label ?? id
          }
          return updated
        })
      })
      .catch(() => {
        if (cancelled) return
        setLabels((current) => {
          const updated = { ...current }
          for (const id of missing) updated[id] = id
          return updated
        })
      })

    return () => {
      cancelled = true
    }
  }, [idsKey])

  return labels
}
