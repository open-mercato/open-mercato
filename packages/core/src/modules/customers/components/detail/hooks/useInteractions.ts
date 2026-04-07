"use client"

import * as React from 'react'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from '../types'

type InteractionsListResponse = {
  items: InteractionSummary[]
  nextCursor?: string
}

export type InteractionCreatePayload = {
  entityId: string
  interactionType: string
  title?: string | null
  body?: string | null
  status?: string
  scheduledAt?: string | null
  priority?: number | null
  customValues?: Record<string, unknown>
  ownerUserId?: string | null
  dealId?: string | null
}

export type InteractionUpdatePayload = {
  interactionType?: string
  title?: string | null
  body?: string | null
  status?: string
  scheduledAt?: string | null
  occurredAt?: string | null
  priority?: number | null
  customValues?: Record<string, unknown>
  ownerUserId?: string | null
  dealId?: string | null
}

export type UseInteractionsOptions = {
  entityId: string | null
  statusFilter?: string
  typeFilter?: string
  excludeTypeFilter?: string
  pageSize?: number
}

export type UseInteractionsResult = {
  interactions: InteractionSummary[]
  isInitialLoading: boolean
  isLoadingMore: boolean
  isMutating: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  createInteraction: (payload: InteractionCreatePayload) => Promise<void>
  updateInteraction: (id: string, payload: InteractionUpdatePayload) => Promise<void>
  completeInteraction: (id: string) => Promise<void>
  cancelInteraction: (id: string) => Promise<void>
  deleteInteraction: (id: string) => Promise<void>
  pendingId: string | null
  totalCount: number
  error: string | null
}

function mergeUnique(existing: InteractionSummary[], incoming: InteractionSummary[]): InteractionSummary[] {
  if (!existing.length) return incoming
  if (!incoming.length) return existing
  const byId = new Map<string, InteractionSummary>()
  const result: InteractionSummary[] = []
  for (const item of existing) {
    byId.set(item.id, item)
    result.push(item)
  }
  for (const item of incoming) {
    if (byId.has(item.id)) {
      const index = result.findIndex((entry) => entry.id === item.id)
      if (index !== -1) result[index] = item
    } else {
      byId.set(item.id, item)
      result.push(item)
    }
  }
  return result
}

export function useInteractions({
  entityId,
  statusFilter,
  typeFilter,
  excludeTypeFilter,
  pageSize = 25,
}: UseInteractionsOptions): UseInteractionsResult {
  const t = useT()
  const [interactions, setInteractions] = React.useState<InteractionSummary[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [isInitialLoading, setIsInitialLoading] = React.useState<boolean>(() => Boolean(entityId))
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)
  const [isMutating, setIsMutating] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const mapResponse = React.useCallback((payload: InteractionsListResponse) => {
    const mapped = Array.isArray(payload.items) ? payload.items : []
    setNextCursor(typeof payload.nextCursor === 'string' && payload.nextCursor.trim().length > 0 ? payload.nextCursor : null)
    setError(null)
    return mapped
  }, [])

  const fetchPage = React.useCallback(
    async (cursor?: string | null): Promise<InteractionsListResponse> => {
      if (!entityId) {
        return { items: [], nextCursor: undefined }
      }
      const params = new URLSearchParams({
        limit: String(pageSize),
        entityId,
        sortField: 'scheduledAt',
        sortDir: 'asc',
      })
      if (cursor) params.set('cursor', cursor)
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('interactionType', typeFilter)
      if (excludeTypeFilter) params.set('excludeInteractionType', excludeTypeFilter)

      return readApiResultOrThrow<InteractionsListResponse>(
        `/api/customers/interactions?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.interactions.load.error', 'Failed to load interactions.') },
      )
    },
    [entityId, excludeTypeFilter, pageSize, statusFilter, typeFilter, t],
  )

  const refresh = React.useCallback(async () => {
    if (!entityId) {
      setInteractions([])
      setNextCursor(null)
      return
    }
    setIsInitialLoading(true)
    try {
      const payload = await fetchPage(null)
      const mapped = mapResponse(payload)
      setInteractions(mapped)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.interactions.load.error', 'Failed to load interactions.')
      setError(message)
      throw err
    } finally {
      setIsInitialLoading(false)
    }
  }, [entityId, fetchPage, mapResponse, t])

  const loadMore = React.useCallback(async () => {
    if (!entityId) return
    if (isLoadingMore) return
    if (!nextCursor) return
    setIsLoadingMore(true)
    try {
      const payload = await fetchPage(nextCursor)
      const mapped = mapResponse(payload)
      setInteractions((prev) => mergeUnique(prev, mapped))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.interactions.load.error', 'Failed to load interactions.')
      setError(message)
      throw err
    } finally {
      setIsLoadingMore(false)
    }
  }, [entityId, fetchPage, isLoadingMore, mapResponse, nextCursor, t])

  React.useEffect(() => {
    if (!entityId) {
      setInteractions([])
      setNextCursor(null)
      setError(null)
      setIsInitialLoading(false)
      return
    }
    setInteractions([])
    setNextCursor(null)
    setError(null)
    let cancelled = false
    setIsInitialLoading(true)
    fetchPage(null)
      .then((payload) => {
        if (cancelled) return
        const mapped = mapResponse(payload)
        setInteractions(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('customers.interactions.load.error', 'Failed to load interactions.')
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setIsInitialLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityId, excludeTypeFilter, statusFilter, typeFilter, fetchPage, mapResponse, t])

  const createInteraction = React.useCallback(
    async (payload: InteractionCreatePayload) => {
      if (!entityId) throw new Error('Interaction creation requires an entity id')
      setIsMutating(true)
      try {
        await apiCallOrThrow(
          '/api/customers/interactions',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('customers.interactions.create.error', 'Failed to create interaction.') },
        )
        await refresh()
      } finally {
        setIsMutating(false)
      }
    },
    [entityId, refresh, t],
  )

  const updateInteraction = React.useCallback(
    async (id: string, payload: InteractionUpdatePayload) => {
      setIsMutating(true)
      try {
        await apiCallOrThrow(
          '/api/customers/interactions',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, ...payload }),
          },
          { errorMessage: t('customers.interactions.update.error', 'Failed to update interaction.') },
        )
        await refresh()
      } finally {
        setIsMutating(false)
      }
    },
    [refresh, t],
  )

  const completeInteraction = React.useCallback(
    async (id: string) => {
      setIsMutating(true)
      setPendingId(id)
      try {
        await apiCallOrThrow(
          '/api/customers/interactions/complete',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          },
          { errorMessage: t('customers.interactions.complete.error', 'Failed to complete interaction.') },
        )
        await refresh()
      } finally {
        setPendingId(null)
        setIsMutating(false)
      }
    },
    [refresh, t],
  )

  const cancelInteraction = React.useCallback(
    async (id: string) => {
      setIsMutating(true)
      setPendingId(id)
      try {
        await apiCallOrThrow(
          '/api/customers/interactions/cancel',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          },
          { errorMessage: t('customers.interactions.cancel.error', 'Failed to cancel interaction.') },
        )
        await refresh()
      } finally {
        setPendingId(null)
        setIsMutating(false)
      }
    },
    [refresh, t],
  )

  const deleteInteraction = React.useCallback(
    async (id: string) => {
      setIsMutating(true)
      try {
        await apiCallOrThrow(
          `/api/customers/interactions?id=${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
          },
          { errorMessage: t('customers.interactions.delete.error', 'Failed to delete interaction.') },
        )
        await refresh()
      } finally {
        setIsMutating(false)
      }
    },
    [refresh, t],
  )

  const hasMore = entityId != null && nextCursor != null

  return {
    interactions,
    isInitialLoading,
    isLoadingMore,
    isMutating,
    hasMore,
    loadMore,
    refresh,
    createInteraction,
    updateInteraction,
    completeInteraction,
    cancelInteraction,
    deleteInteraction,
    pendingId,
    totalCount: interactions.length,
    error,
  }
}
