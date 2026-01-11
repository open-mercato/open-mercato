'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { QuoteLine } from './useCalculations'

type UseQuoteLinesOptions = {
  quoteId: string
  onError?: (error: string) => void
}

type QuoteLinesResponse = {
  items: QuoteLine[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export function useQuoteLines({ quoteId, onError }: UseQuoteLinesOptions) {
  const queryClient = useQueryClient()
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, Partial<QuoteLine>>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const { data, isLoading, error } = useQuery({
    queryKey: ['quote-lines', quoteId],
    queryFn: async () => {
      const response = await apiCall<QuoteLinesResponse>(
        `/api/fms_quotes/quote-lines?quoteId=${quoteId}&limit=100`
      )
      if (!response.ok) throw new Error('Failed to load quote lines')
      return response.result ?? { items: [], total: 0, page: 1, limit: 100, totalPages: 0 }
    },
    enabled: !!quoteId,
  })

  const lines = data?.items ?? []

  const createMutation = useMutation({
    mutationFn: async (lineData: Partial<QuoteLine> & { quoteId: string }) => {
      const response = await apiCall<QuoteLine>('/api/fms_quotes/quote-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineData),
      })
      if (!response.ok) throw new Error('Failed to create line')
      return response.result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote-lines', quoteId] })
    },
    onError: (err) => {
      onError?.(err instanceof Error ? err.message : 'Failed to create line')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<QuoteLine>) => {
      const response = await apiCall<QuoteLine>(`/api/fms_quotes/quote-lines/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) throw new Error('Failed to update line')
      return response.result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote-lines', quoteId] })
    },
    onError: (err) => {
      onError?.(err instanceof Error ? err.message : 'Failed to update line')
      setSaveStatus('error')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiCall(`/api/fms_quotes/quote-lines/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete line')
      return response.result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote-lines', quoteId] })
    },
    onError: (err) => {
      onError?.(err instanceof Error ? err.message : 'Failed to delete line')
    },
  })

  const addLine = useCallback(
    async (lineData: Omit<Partial<QuoteLine>, 'id' | 'quoteId'>) => {
      return createMutation.mutateAsync({ quoteId, ...lineData })
    },
    [createMutation, quoteId]
  )

  const updateLine = useCallback(
    (id: string, updates: Partial<QuoteLine>) => {
      setPendingUpdates((prev) => {
        const newMap = new Map(prev)
        const existing = newMap.get(id) || {}
        newMap.set(id, { ...existing, ...updates })
        return newMap
      })
    },
    []
  )

  const removeLine = useCallback(
    async (id: string) => {
      return deleteMutation.mutateAsync(id)
    },
    [deleteMutation]
  )

  // Debounced auto-save
  useEffect(() => {
    if (pendingUpdates.size === 0) return

    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving')

      const updates = Array.from(pendingUpdates.entries())
      setPendingUpdates(new Map())

      try {
        await Promise.all(
          updates.map(([id, changes]) => updateMutation.mutateAsync({ id, ...changes }))
        )
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('error')
      }
    }, 2000)

    return () => clearTimeout(saveTimeoutRef.current)
  }, [pendingUpdates, updateMutation])

  // Force save (for immediate save before close)
  const forceSave = useCallback(async () => {
    clearTimeout(saveTimeoutRef.current)

    if (pendingUpdates.size === 0) return

    setSaveStatus('saving')
    const updates = Array.from(pendingUpdates.entries())
    setPendingUpdates(new Map())

    try {
      await Promise.all(
        updates.map(([id, changes]) => updateMutation.mutateAsync({ id, ...changes }))
      )
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [pendingUpdates, updateMutation])

  return {
    lines,
    isLoading,
    error,
    saveStatus,
    addLine,
    updateLine,
    removeLine,
    forceSave,
    hasPendingChanges: pendingUpdates.size > 0,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
