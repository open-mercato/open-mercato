"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type EmailDuplicateMatch = {
  id: string
  displayName: string
  email: string
}

type UseEmailDuplicateCheckOptions = {
  recordId?: string | null
  disabled?: boolean
  debounceMs?: number
  matchMode?: 'exact' | 'prefix'
}

const DEFAULT_DEBOUNCE_MS = 300

export function useEmailDuplicateCheck(
  email: string | null | undefined,
  { recordId, disabled, debounceMs = DEFAULT_DEBOUNCE_MS, matchMode = 'exact' }: UseEmailDuplicateCheckOptions = {}
) {
  const [duplicate, setDuplicate] = React.useState<EmailDuplicateMatch | null>(null)
  const [checking, setChecking] = React.useState(false)

  React.useEffect(() => {
    if (disabled) {
      setDuplicate(null)
      setChecking(false)
      return
    }

    const trimmed = typeof email === 'string' ? email.trim() : ''
    if (!trimmed.length) {
      setDuplicate(null)
      setChecking(false)
      return
    }

    const normalized = trimmed.toLowerCase()
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setChecking(true)
      try {
        const queryParam =
          matchMode === 'prefix'
            ? `emailStartsWith=${encodeURIComponent(normalized)}`
            : `email=${encodeURIComponent(normalized)}`
        const call = await apiCall<{ items?: unknown[] }>(`/api/customers/people?${queryParam}&pageSize=5&page=1`, {
          signal: controller.signal,
        })
        if (!call.ok) {
          if (!cancelled) setDuplicate(null)
          return
        }
        const payload = call.result ?? {}
        const items = Array.isArray(payload?.items) ? payload.items : []
        const match =
          items
            .map((item: Record<string, unknown>) => {
              const id = typeof item?.id === 'string' ? item.id : null
              const displayName = typeof item?.display_name === 'string' ? item.display_name : null
              const emailValue = typeof item?.primary_email === 'string' ? item.primary_email.toLowerCase() : null
              return id && displayName && emailValue
                ? { id, displayName, email: emailValue }
                : null
            })
            .filter((entry: EmailDuplicateMatch | null): entry is EmailDuplicateMatch => !!entry)
            .find((entry: EmailDuplicateMatch) => {
              if (entry.id === recordId) return false
              return matchMode === 'prefix'
                ? entry.email.startsWith(normalized)
                : entry.email === normalized
            }) ?? null
        if (!cancelled) {
          setDuplicate(match)
        }
      } catch (error) {
        if (cancelled) return
        if ((error as Error)?.name === 'AbortError') return
        setDuplicate(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, debounceMs)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [email, recordId, disabled, debounceMs, matchMode])

  return { duplicate, checking }
}
