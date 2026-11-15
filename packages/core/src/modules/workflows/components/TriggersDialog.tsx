'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TriggersEditor } from './TriggersEditor'
import type { WorkflowDefinitionTrigger } from '../data/entities'

export interface TriggersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggers: WorkflowDefinitionTrigger[]
  onSave: (triggers: WorkflowDefinitionTrigger[]) => void
}

/**
 * Focused editor for a definition's triggers, opened from the START node's
 * trigger cap (fidelity gap #5, Direction A). It replaces the detour through the
 * five-section definition drawer: the author clicked "what starts this", so the
 * affordance opens exactly that and nothing else.
 *
 * It edits a WORKING COPY so Cancel truly reverts; Save commits to the caller.
 * Hosts the lighter inline `TriggersEditor` (Switch toggles + click-to-expand
 * editing, no nested drawer). Cmd/Ctrl+Enter saves, Escape cancels, per the
 * shared dialog UX contract.
 */
export function TriggersDialog({ open, onOpenChange, triggers, onSave }: TriggersDialogProps) {
  const t = useT()
  const [working, setWorking] = useState<WorkflowDefinitionTrigger[]>(triggers)

  // Re-seed the working copy each time the dialog opens so a prior Cancel never
  // leaks stale edits into the next session.
  useEffect(() => {
    if (open) setWorking(triggers)
  }, [open, triggers])

  const handleSave = () => {
    onSave(working)
    onOpenChange(false)
  }

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave, onCancel: () => onOpenChange(false) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        onKeyDown={handleKeyDown}
        data-testid="workflow-triggers-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('workflows.triggersDialog.title', 'Triggers')}</DialogTitle>
          <DialogDescription>
            {t(
              'workflows.triggersDialog.description',
              'What starts this workflow. Manual and API start are always available.',
            )}
          </DialogDescription>
        </DialogHeader>

        <TriggersEditor value={working} onChange={setWorking} />

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t('workflows.triggersDialog.save', 'Save triggers')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
