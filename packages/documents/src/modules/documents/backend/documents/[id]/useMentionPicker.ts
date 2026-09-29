"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { resolveSearchMinTokenLength } from '@open-mercato/shared/lib/search/config'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'

export type MentionUser = {
  id: string
  label: string
  secondary: string | null
}

const MENTION_SEARCH_MIN_LENGTH = resolveSearchMinTokenLength()

function isMentionSearchUnavailableStatus(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function normalizeUser(value: unknown, fallbackLabel: string): MentionUser | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const label = firstSafeDocumentsDisplayLabel(readString(record, 'label'), fallbackLabel)
  if (!id || !label) return null
  const rawSecondary = sanitizeDocumentsDisplayLabel(readString(record, 'secondary'))
  return { id, label, secondary: rawSecondary && rawSecondary !== label ? rawSecondary : null }
}

export function readMentionUserItems(payload: unknown, fallbackLabel: string): MentionUser[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => normalizeUser(item, fallbackLabel))
      .filter((user): user is MentionUser => user !== null)
  }
  const record = readRecord(payload)
  if (!record) return []
  for (const candidate of [record.items, record.data]) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => normalizeUser(item, fallbackLabel))
        .filter((user): user is MentionUser => user !== null)
    }
  }
  return []
}

export function buildMentionPrincipalUrl(documentId: string, search: string): string {
  const params = new URLSearchParams({
    mode: 'mention',
    type: 'user',
    search,
    page: '1',
    pageSize: '8',
  })
  return `/api/documents/${encodeURIComponent(documentId)}/principals?${params.toString()}`
}

export function nextMentionIndex(current: number, direction: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : itemCount - 1
  return Math.min(itemCount - 1, Math.max(0, current + direction))
}

export function useMentionPicker(input: {
  documentId: string
  fallbackLabel: string
  onPick: (user: { id: string; name: string }) => void
  disabled: boolean
}) {
  const [query, setQuery] = React.useState('')
  const [users, setUsers] = React.useState<MentionUser[]>([])
  const [open, setOpen] = React.useState(false)
  const [unavailable, setUnavailable] = React.useState(false)
  const [hasError, setHasError] = React.useState(false)
  const [retryToken, setRetryToken] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [resultQuery, setResultQuery] = React.useState<string | null>(null)
  const currentQueryRef = React.useRef('')
  const resultQueryRef = React.useRef<string | null>(null)
  const activeRequestRef = React.useRef<AbortController | null>(null)

  const clearResults = React.useCallback(() => {
    resultQueryRef.current = null
    setResultQuery(null)
    setUsers([])
    setHasSearched(false)
    setHasError(false)
    setActiveIndex(-1)
  }, [])

  const onQueryChange = React.useCallback((nextQuery: string) => {
    const normalizedQuery = nextQuery.trim()
    currentQueryRef.current = normalizedQuery
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    clearResults()
    const shouldSearch = !input.disabled
      && !unavailable
      && normalizedQuery.length >= MENTION_SEARCH_MIN_LENGTH
    setOpen(shouldSearch)
    setIsLoading(shouldSearch)
    setQuery(nextQuery)
  }, [clearResults, input.disabled, unavailable])

  React.useEffect(() => {
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    currentQueryRef.current = ''
    setQuery('')
    setOpen(false)
    setUnavailable(false)
    setIsLoading(false)
    clearResults()
  }, [clearResults, input.documentId])

  React.useEffect(() => {
    const trimmedQuery = query.trim()
    if (input.disabled || unavailable || trimmedQuery.length < MENTION_SEARCH_MIN_LENGTH) {
      currentQueryRef.current = trimmedQuery
      setOpen(false)
      setIsLoading(false)
      clearResults()
      return
    }

    let cancelled = false
    const controller = new AbortController()
    activeRequestRef.current = controller
    setOpen(true)
    setIsLoading(true)
    setHasSearched(false)
    const timer = window.setTimeout(() => {
      void apiCall<unknown>(
        buildMentionPrincipalUrl(input.documentId, trimmedQuery),
        {
          signal: controller.signal,
          headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
        },
        { fallback: { items: [] } },
      )
        .then((call) => {
          if (cancelled || controller.signal.aborted || currentQueryRef.current !== trimmedQuery) return
          if (!call.ok) {
            clearResults()
            if (isMentionSearchUnavailableStatus(call.status)) {
              setUnavailable(true)
              setOpen(false)
            } else {
              setHasError(true)
              setOpen(true)
            }
            return
          }
          const nextUsers = readMentionUserItems(call.result, input.fallbackLabel).slice(0, 8)
          resultQueryRef.current = trimmedQuery
          setResultQuery(trimmedQuery)
          setUsers(nextUsers)
          setHasSearched(true)
          setActiveIndex(nextUsers.length > 0 ? 0 : -1)
        })
        .catch(() => {
          if (!cancelled && !controller.signal.aborted && currentQueryRef.current === trimmedQuery) {
            clearResults()
            setHasError(true)
            setOpen(true)
          }
        })
        .finally(() => {
          if (!cancelled && !controller.signal.aborted && currentQueryRef.current === trimmedQuery) {
            setIsLoading(false)
          }
          if (activeRequestRef.current === controller) activeRequestRef.current = null
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
      if (activeRequestRef.current === controller) activeRequestRef.current = null
    }
  }, [clearResults, input.disabled, input.documentId, input.fallbackLabel, query, retryToken, unavailable])

  const isDisabled = input.disabled || unavailable
  const resultsAreCurrent = resultQuery !== null
    && resultQuery === query.trim()
    && resultQueryRef.current === resultQuery
    && currentQueryRef.current === resultQuery

  const pick = React.useCallback((user: MentionUser, boundQuery: string | null) => {
    if (
      isDisabled
      || !boundQuery
      || resultQueryRef.current !== boundQuery
      || currentQueryRef.current !== boundQuery
    ) return
    input.onPick({ id: user.id, name: user.label })
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    currentQueryRef.current = ''
    setQuery('')
    setOpen(false)
    setIsLoading(false)
    clearResults()
  }, [clearResults, input.onPick, isDisabled])

  const retry = React.useCallback(() => {
    const trimmedQuery = query.trim()
    if (input.disabled || unavailable || trimmedQuery.length < MENTION_SEARCH_MIN_LENGTH) return
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    clearResults()
    setOpen(true)
    setIsLoading(true)
    setRetryToken((token) => token + 1)
  }, [clearResults, input.disabled, query, unavailable])

  return {
    query,
    users,
    open,
    unavailable,
    hasError,
    isLoading,
    hasSearched,
    activeIndex,
    resultQuery,
    isDisabled,
    resultsAreCurrent,
    retry,
    onQueryChange,
    dismiss: () => setOpen(false),
    moveActive: (direction: 1 | -1) => setActiveIndex((index) => (
      nextMentionIndex(index, direction, resultsAreCurrent ? users.length : 0)
    )),
    activate: (index: number, boundQuery: string | null) => {
      if (boundQuery && resultQueryRef.current === boundQuery) setActiveIndex(index)
    },
    pick,
  }
}
