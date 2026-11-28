'use client'

import { useId, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { GuardedMutationRunner } from '../../backend/customers/deals/[id]/hooks/types'
import { dealReopenValues } from '../../lib/dealReopen'
import { isTerminalPipelineOutcomeLabel } from './pipelineStageUtils'

type ReopenDealActionProps = {
  deal: { id: string; pipelineId: string | null; updatedAt: string }
  stages: { id: string; label: string }[]
  disabled: boolean
  runMutation: GuardedMutationRunner
  confirmDiscardIfDirty: () => Promise<boolean>
  onReopened: () => Promise<void>
}

export function ReopenDealAction({ deal, stages, disabled, runMutation, confirmDiscardIfDirty, onReopened }: ReopenDealActionProps) {
  const t = useT()
  const stageLabelId = useId()
  const [open, setOpen] = useState(false)
  const [stageId, setStageId] = useState('')
  const [pending, setPending] = useState(false)
  const openStages = stages.filter((stage) => !isTerminalPipelineOutcomeLabel(stage.label))
  const requiresStage = deal.pipelineId !== null
  const hasValidStage = !requiresStage || openStages.some((stage) => stage.id === stageId)
  const actionLabel = t('customers.deals.reopen.action', 'Reopen deal')

  async function openDialog() {
    if (!await confirmDiscardIfDirty()) return
    setStageId('')
    setOpen(true)
  }

  async function reopen() {
    if (pending || !hasValidStage) return
    const input = { id: deal.id, pipelineStageId: requiresStage ? stageId : null }
    setPending(true)
    try {
      await runMutation(
        () => withScopedApiRequestHeaders(buildOptimisticLockHeader(deal.updatedAt), () => apiCallOrThrow('/api/customers/deals/reopen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })),
        { ...input, ...dealReopenValues, operation: 'reopen' },
      )
      setOpen(false)
      flash(t('customers.deals.reopen.success', 'Deal reopened.'), 'success')
      await onReopened()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => { void onReopened() } })) {
        setOpen(false)
      } else {
        flash(t('customers.deals.reopen.failed', 'Could not reopen the deal.'), 'error')
      }
    } finally {
      setPending(false)
    }
  }

  const closeDialog = () => {
    if (!pending) setOpen(false)
  }
  const onKeyDown = useDialogKeyHandler({
    onConfirm: () => { void reopen() },
    onCancel: closeDialog,
    disabled: pending || !hasValidStage,
  })

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog() }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || pending}
          onClick={(event) => {
            event.preventDefault()
            void openDialog()
          }}
        >
          {actionLabel}
        </Button>
      </DialogTrigger>
      <DialogContent onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{actionLabel}</DialogTitle>
          <DialogDescription>{t('customers.deals.reopen.description', 'Return this deal to active work. Its current closure outcome and loss details will be cleared.')}</DialogDescription>
        </DialogHeader>
        {requiresStage && (openStages.length > 0 ? (
          <div className="space-y-2">
            <Label id={stageLabelId}>{t('customers.deals.reopen.stage', 'Open stage')}</Label>
            <Select value={stageId} onValueChange={setStageId} disabled={pending}>
              <SelectTrigger aria-labelledby={stageLabelId}>
                <SelectValue placeholder={t('customers.deals.reopen.selectStage', 'Select a stage')} />
              </SelectTrigger>
              <SelectContent>
                {openStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('customers.deals.reopen.noStages', 'This pipeline has no open stages.')}</p>
        ))}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog} disabled={pending}>{t('ui.actions.cancel', 'Cancel')}</Button>
          <Button type="button" disabled={pending || !hasValidStage} onClick={() => { void reopen() }}>
            {pending ? t('customers.deals.reopen.pending', 'Reopening…') : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
