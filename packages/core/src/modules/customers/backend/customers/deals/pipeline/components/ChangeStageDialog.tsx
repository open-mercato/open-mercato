"use client"

import * as React from 'react'
import { Workflow } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type ChangeStageOption = {
  id: string
  label: string
}

type ChangeStageDialogProps = {
  open: boolean
  selectedCount: number
  pipelineName: string
  stages: ChangeStageOption[]
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (stageId: string) => void
}

export function ChangeStageDialog({
  open,
  selectedCount,
  pipelineName,
  stages,
  isSubmitting,
  onClose,
  onConfirm,
}: ChangeStageDialogProps): React.ReactElement {
  const t = useT()
  const [draftStageId, setDraftStageId] = React.useState<string | null>(stages[0]?.id ?? null)

  React.useEffect(() => {
    if (open) setDraftStageId(stages[0]?.id ?? null)
  }, [open, stages])

  const handleConfirm = () => {
    if (draftStageId) onConfirm(draftStageId)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleConfirm()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="size-4" aria-hidden="true" />
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeStage.title',
              'Change stage for {count} deals',
              { count: selectedCount },
            )}
          </DialogTitle>
          <DialogDescription>
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeStage.context',
              'Pipeline: {pipeline}',
              { pipeline: pipelineName },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 py-1">
          {stages.map((stage) => {
            const isSelected = draftStageId === stage.id
            return (
              <Button
                variant="ghost"
                key={stage.id}
                type="button"
                onClick={() => setDraftStageId(stage.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isSelected ? 'bg-muted' : ''
                }`}
              >
                <span className="font-medium text-foreground">{stage.label}</span>
                <span
                  className={`inline-flex size-4 items-center justify-center rounded-full border ${
                    isSelected ? 'border-primary bg-primary' : 'border-input'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected ? (
                    <span className="size-1.5 rounded-full bg-primary-foreground" />
                  ) : null}
                </span>
              </Button>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button" disabled={isSubmitting}>
            {translateWithFallback(t, 'customers.deals.kanban.filter.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!draftStageId || isSubmitting || stages.length === 0}
          >
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeStage.confirm',
              'Move {count} deals',
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ChangeStageDialog
