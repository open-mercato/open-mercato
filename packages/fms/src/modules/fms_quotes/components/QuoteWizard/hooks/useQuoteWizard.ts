'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuoteLines } from './useQuoteLines'
import { useCalculations, calculateQuoteTotals, type QuoteLine } from './useCalculations'

export type Quote = {
  id: string
  quoteNumber?: string | null
  clientName?: string | null
  containerCount?: number | null
  status: string
  direction?: string | null
  incoterm?: string | null
  cargoType?: string | null
  originPortCode?: string | null
  destinationPortCode?: string | null
  validUntil?: string | null
  currencyCode: string
  notes?: string | null
}

type UseQuoteWizardOptions = {
  quoteId: string
  onError?: (error: string) => void
}

export function useQuoteWizard({ quoteId, onError }: UseQuoteWizardOptions) {
  const queryClient = useQueryClient()
  const [showProductSearch, setShowProductSearch] = useState(false)

  // Fetch quote data
  const {
    data: quote,
    isLoading: isLoadingQuote,
    error: quoteError,
  } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => {
      const response = await apiCall<Quote>(`/api/fms_quotes/${quoteId}`)
      if (!response.ok) throw new Error('Failed to load quote')
      return response.result
    },
    enabled: !!quoteId,
  })

  // Quote lines management
  const {
    lines,
    isLoading: isLoadingLines,
    saveStatus,
    addLine,
    updateLine,
    removeLine,
    forceSave,
    hasPendingChanges,
    isCreating,
    isDeleting,
  } = useQuoteLines({ quoteId, onError })

  // Calculations
  const {
    recalculateFromMargin,
    recalculateFromSales,
    recalculateFromQuantity,
  } = useCalculations()

  // Quote update mutation
  const updateQuoteMutation = useMutation({
    mutationFn: async (updates: Partial<Quote>) => {
      const response = await apiCall(`/api/fms_quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) throw new Error('Failed to update quote')
      return response.result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quote', quoteId] })
    },
    onError: (err) => {
      onError?.(err instanceof Error ? err.message : 'Failed to update quote')
    },
  })

  const updateQuote = useCallback(
    (updates: Partial<Quote>) => {
      updateQuoteMutation.mutate(updates)
    },
    [updateQuoteMutation]
  )

  // Handle line field updates with calculations
  const handleLineUpdate = useCallback(
    (lineId: string, field: string, value: unknown) => {
      const line = lines.find((l) => l.id === lineId)
      if (!line) return

      let updates: Partial<QuoteLine> = { [field]: value }

      // Apply bidirectional calculation based on which field changed
      if (field === 'marginPercent') {
        const additionalUpdates = recalculateFromMargin(line, Number(value))
        updates = { ...updates, ...additionalUpdates }
      } else if (field === 'unitSales') {
        const additionalUpdates = recalculateFromSales(line, Number(value))
        updates = { ...updates, ...additionalUpdates }
      } else if (field === 'quantity') {
        const additionalUpdates = recalculateFromQuantity(line, Number(value))
        updates = { ...updates, ...additionalUpdates }
      }

      updateLine(lineId, updates)
    },
    [lines, updateLine, recalculateFromMargin, recalculateFromSales, recalculateFromQuantity]
  )

  // Calculate totals
  const totals = calculateQuoteTotals(lines)

  // Open/close product search
  const openProductSearch = useCallback(() => setShowProductSearch(true), [])
  const closeProductSearch = useCallback(() => setShowProductSearch(false), [])

  return {
    // Quote data
    quote,
    isLoadingQuote,
    quoteError,
    updateQuote,

    // Lines data
    lines,
    isLoadingLines,
    addLine,
    updateLine: handleLineUpdate,
    removeLine,

    // Save status
    saveStatus,
    forceSave,
    hasPendingChanges,
    isCreating,
    isDeleting,

    // Totals
    totals,

    // Product search
    showProductSearch,
    openProductSearch,
    closeProductSearch,
  }
}
