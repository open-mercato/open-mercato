import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DealDetailPayload, GuardedMutationRunner } from './types'

type UseDealPipelineOptions = {
  currentDealId: string | null
  data: DealDetailPayload | null
  runMutationWithContext: GuardedMutationRunner
  confirmDiscardIfDirty: () => Promise<boolean>
  onStageChanged: () => Promise<void>
}

type UseDealPipelineResult = {
  isStageSaving: boolean
  handleStageChange: (nextStageId: string) => Promise<void>
}

export function useDealPipeline({
  currentDealId,
  data,
  runMutationWithContext,
  confirmDiscardIfDirty,
  onStageChanged,
}: UseDealPipelineOptions): UseDealPipelineResult {
  const t = useT()
  const [isStageSaving, setIsStageSaving] = React.useState(false)

  const handleStageChange = React.useCallback(
    async (nextStageId: string) => {
      if (!currentDealId || !data) return
      if (nextStageId === data.deal.pipelineStageId) return
      if (!(await confirmDiscardIfDirty())) return
      setIsStageSaving(true)
      try {
        await runMutationWithContext(
          () => updateCrud('customers/deals', { id: currentDealId, pipelineStageId: nextStageId }),
          { id: currentDealId, pipelineStageId: nextStageId, operation: 'updateDealStage' },
        )
        flash(t('customers.deals.detail.stageUpdateSuccess', 'Deal stage updated.'), 'success')
        await onStageChanged()
      } catch {
        flash(t('customers.deals.detail.stageUpdateError', 'Failed to update deal stage.'), 'error')
      } finally {
        setIsStageSaving(false)
      }
    },
    [confirmDiscardIfDirty, currentDealId, data, onStageChanged, runMutationWithContext, t],
  )

  return {
    isStageSaving,
    handleStageChange,
  }
}
