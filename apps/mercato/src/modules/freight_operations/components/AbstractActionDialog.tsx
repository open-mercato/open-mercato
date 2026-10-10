"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const CONTEXT_ID = 'freight_operations.abstracts.action'

export type AbstractNoteAction = 'finalize' | 'record-offline-approval' | 'cancel'

export type AbstractActionTarget = {
  id: string
  abstractNumber: string
  updatedAt?: string | null
  updated_at?: string | null
}

const ACTION_PATHS: Record<AbstractNoteAction, string> = {
  finalize: 'finalize',
  'record-offline-approval': 'record-offline-approval',
  cancel: 'cancel',
}

/**
 * The three abstract verbs that only carry prose: finalizing without the
 * customer gate, recording an approval received offline, and cancelling. They
 * share one dialog because the contract is identical — a note (a reference too,
 * for the offline approval) and the abstract's version for the lock.
 */
export function AbstractActionDialog({
  action,
  target,
  onOpenChange,
  onDone,
}: {
  /** `null` keeps the dialog closed. */
  action: AbstractNoteAction | null
  target: AbstractActionTarget | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const t = useT()
  const open = action !== null && target !== null
  const [note, setNote] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!target) return
    setNote('')
    setReference('')
    setError(null)
  }, [target, action])

  const requiresReference = action === 'record-offline-approval'

  const submit = React.useCallback(async () => {
    if (!target || !action) return
    if (!note.trim()) {
      setError(t('freight_operations.abstracts.actions.noteRequired', 'A note is required.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(target.updatedAt ?? target.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/abstracts/${ACTION_PATHS[action]}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: target.id,
              note: note.trim(),
              ...(requiresReference && reference.trim() ? { reference: reference.trim() } : {}),
              ...(action === 'cancel' ? { reason: note.trim() } : {}),
            }),
          }, { errorMessage: t(`freight_operations.abstracts.actions.${action}.error`, 'Unable to complete the action.') }),
        ),
        mutationPayload: { operation: `abstracts.${action}`, id: target.id, updatedAt: target.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_trip_abstract', resourceId: target.id, retryLastMutation },
      })
      flash(t(`freight_operations.abstracts.actions.${action}.success`, 'Abstract updated.'), 'success')
      onDone()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t(`freight_operations.abstracts.actions.${action}.error`, 'Unable to complete the action.'))
    }
  }, [action, note, onDone, reference, requiresReference, retryLastMutation, runMutation, t, target])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t(`freight_operations.abstracts.actions.${action}.title`, 'Confirm the action')}</DialogTitle>
          <DialogDescription>
            {t(`freight_operations.abstracts.actions.${action}.description`, 'This action is recorded on the abstract with the note you provide.')}
            {target?.abstractNumber ? ` — ${target.abstractNumber}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {requiresReference ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.abstracts.actions.offlineReference', 'Reference')}</span>
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder={t('freight_operations.abstracts.actions.offlineReferencePlaceholder', 'Email or letter number')}
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.abstracts.actions.note', 'Note')}</span>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.abstracts.actions.cancelButton', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t(`freight_operations.abstracts.actions.${action}.label`, 'Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
