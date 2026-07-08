import * as React from 'react'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DealStatsPayload, GuardedMutationRunner } from './types'

type UseDealClosureOptions = {
  currentDealId: string | null
  dealUpdatedAt: string | null
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
  dealUpdatedAt,
  runMutationWithContext,
  confirmDiscardIfDirty,
  onClosed,
}: UseDealClosureOptions): UseDealClosureResult {
  const t = useT()
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
    try {
      await runMutationWithContext(
        () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(dealUpdatedAt),
          () => updateCrud('customers/deals', { id: currentDealId, closureOutcome: 'won', status: 'win' }),
        ),
        { id: currentDealId, closureOutcome: 'won', status: 'win', operation: 'closeWon' },
      )
    } catch (err) {
      if (!surfaceRecordConflict(err, t, { onRefresh: () => { void onClosed() } })) {
        flash(t('customers.deals.detail.closeWonError', 'Failed to mark deal as won.'), 'error')
      }
      return
    }
    const stats = await fetchDealStats()
    setWonStats(stats)
    setWonPopupOpen(true)
    await onClosed()
  }, [confirmDiscardIfDirty, currentDealId, dealUpdatedAt, fetchDealStats, onClosed, runMutationWithContext, t])

  const handleLostConfirm = React.useCallback(
    async (input: { lossReasonId: string; lossNotes?: string }) => {
      if (!currentDealId) return
      if (!(await confirmDiscardIfDirty())) return
      const lossPayload = {
        id: currentDealId,
        closureOutcome: 'lost' as const,
        status: 'loose',
        lossReasonId: input.lossReasonId,
        ...(input.lossNotes ? { lossNotes: input.lossNotes } : {}),
      }
      try {
        await runMutationWithContext(
          () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(dealUpdatedAt),
            () => updateCrud('customers/deals', lossPayload),
          ),
          {
            ...lossPayload,
            operation: 'closeLost',
          },
        )
      } catch (err) {
        if (!surfaceRecordConflict(err, t, { onRefresh: () => { void onClosed() } })) {
          flash(t('customers.deals.detail.closeLostError', 'Failed to mark deal as lost.'), 'error')
        }
        return
      }
      setLostDialogOpen(false)
      const stats = await fetchDealStats()
      setLostStats(stats)
      setLostPopupOpen(true)
      await onClosed()
    },
    [confirmDiscardIfDirty, currentDealId, dealUpdatedAt, fetchDealStats, onClosed, runMutationWithContext, t],
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
