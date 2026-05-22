import * as React from 'react'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { DealStatsPayload, GuardedMutationRunner } from './types'

type UseDealClosureOptions = {
  currentDealId: string | null
  runMutationWithContext: GuardedMutationRunner
  confirmDiscardIfDirty: () => Promise<boolean>
  onClosed: () => Promise<void>
}

type UseDealClosureResult = {
  lostDialogOpen: boolean
  wonPopupOpen: boolean
  lostPopupOpen: boolean
  wonStats: DealStatsPayload | null
  lostStats: DealStatsPayload | null
  openLostDialog: () => void
  closeLostDialog: () => void
  closeWonPopup: () => void
  closeLostPopup: () => void
  handleWon: () => Promise<void>
  handleLostConfirm: (input: { lossReasonId: string; lossNotes?: string }) => Promise<void>
}

export function useDealClosure({
  currentDealId,
  runMutationWithContext,
  confirmDiscardIfDirty,
  onClosed,
}: UseDealClosureOptions): UseDealClosureResult {
  const [lostDialogOpen, setLostDialogOpen] = React.useState(false)
  const [wonPopupOpen, setWonPopupOpen] = React.useState(false)
  const [lostPopupOpen, setLostPopupOpen] = React.useState(false)
  const [wonStats, setWonStats] = React.useState<DealStatsPayload | null>(null)
  const [lostStats, setLostStats] = React.useState<DealStatsPayload | null>(null)

  const fetchDealStats = React.useCallback(async (): Promise<DealStatsPayload | null> => {
    if (!currentDealId) return null
    try {
      return await readApiResultOrThrow<DealStatsPayload>(
        `/api/customers/deals/${encodeURIComponent(currentDealId)}/stats`,
      )
    } catch (statsError) {
      console.error('customers.deals.detail.stats failed', statsError)
      return null
    }
  }, [currentDealId])

  const handleWon = React.useCallback(async () => {
    if (!currentDealId) return
    if (!(await confirmDiscardIfDirty())) return
    await runMutationWithContext(
      () => updateCrud('customers/deals', { id: currentDealId, closureOutcome: 'won', status: 'win' }),
      { id: currentDealId, closureOutcome: 'won', status: 'win', operation: 'closeWon' },
    )
    const stats = await fetchDealStats()
    setWonStats(stats)
    setWonPopupOpen(true)
    await onClosed()
  }, [confirmDiscardIfDirty, currentDealId, fetchDealStats, onClosed, runMutationWithContext])

  const handleLostConfirm = React.useCallback(
    async (input: { lossReasonId: string; lossNotes?: string }) => {
      if (!currentDealId) return
      if (!(await confirmDiscardIfDirty())) return
      await runMutationWithContext(
        () =>
          updateCrud('customers/deals', {
            id: currentDealId,
            closureOutcome: 'lost',
            status: 'loose',
            lossReasonId: input.lossReasonId,
            lossNotes: input.lossNotes ?? null,
          }),
        {
          id: currentDealId,
          closureOutcome: 'lost',
          status: 'loose',
          lossReasonId: input.lossReasonId,
          lossNotes: input.lossNotes ?? null,
          operation: 'closeLost',
        },
      )
      setLostDialogOpen(false)
      const stats = await fetchDealStats()
      setLostStats(stats)
      setLostPopupOpen(true)
      await onClosed()
    },
    [confirmDiscardIfDirty, currentDealId, fetchDealStats, onClosed, runMutationWithContext],
  )

  const openLostDialog = React.useCallback(() => setLostDialogOpen(true), [])
  const closeLostDialog = React.useCallback(() => setLostDialogOpen(false), [])
  const closeWonPopup = React.useCallback(() => setWonPopupOpen(false), [])
  const closeLostPopup = React.useCallback(() => setLostPopupOpen(false), [])

  return {
    lostDialogOpen,
    wonPopupOpen,
    lostPopupOpen,
    wonStats,
    lostStats,
    openLostDialog,
    closeLostDialog,
    closeWonPopup,
    closeLostPopup,
    handleWon,
    handleLostConfirm,
  }
}
