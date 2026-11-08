"use client"

import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'

const DELETE_FEATURE = 'inbox_ops.proposals.manage'

/** Whether the viewer may delete inbox emails (`POST /api/auth/feature-check`); `false` until confirmed. */
export function useCanDeleteInboxEmail(): boolean {
  const [allowed, setAllowed] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: [DELETE_FEATURE] }),
    })
      .then((call) => {
        if (!cancelled) setAllowed(call.ok && hasAllFeatures([DELETE_FEATURE], call.result?.granted ?? []))
      })
      .catch(() => {
        if (!cancelled) setAllowed(false)
      })
    return () => { cancelled = true }
  }, [])
  return allowed
}

export type DeletableInboxEmail = { id: string; subject?: string | null; updatedAt?: string | null }

export type DeleteEmailDialogProps = {
  /** The email to delete; `null` closes the dialog. */
  email: DeletableInboxEmail | null
  onClose: () => void
  /** Runs after a successful delete, once the dialog closed (reload the log, leave the proposal). */
  onDeleted: () => void | Promise<void>
}

/**
 * Confirms and deletes an inbox email, which also releases its attachments and their quota. The
 * request carries the email's `updatedAt` as the optimistic-lock header; a 409 conflict is shown on
 * the record-conflict bar by `useGuardedMutation` and keeps the dialog open, like any other error.
 */
export function DeleteEmailDialog({ email, onClose, onDeleted }: DeleteEmailDialogProps) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'inbox-ops-email-delete',
  })
  const [isDeleting, setIsDeleting] = React.useState(false)
  const failedMessage = t('inbox_ops.emails.delete.failed', 'Failed to delete email')

  const handleDelete = React.useCallback(async () => {
    if (!email || isDeleting) return
    setIsDeleting(true)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(email.updatedAt ?? null),
          () => apiCallOrThrow<{ ok: boolean }>(
            `/api/inbox_ops/emails/${encodeURIComponent(email.id)}`,
            // The route's own 403 message is flashed below instead of the generic access banner.
            { method: 'DELETE', headers: { 'x-om-forbidden-redirect': '0' } },
            { errorMessage: failedMessage },
          ),
        ),
        context: { retryLastMutation },
        mutationPayload: { id: email.id },
      })
      flash(t('inbox_ops.emails.delete.success', 'Email deleted'), 'success')
      onClose()
      await onDeleted()
    } catch (error) {
      if (!extractOptimisticLockConflict(error)) {
        const message = error instanceof Error ? error.message.trim() : ''
        flash(message || failedMessage, 'error')
      }
    } finally {
      setIsDeleting(false)
    }
  }, [email, failedMessage, isDeleting, onClose, onDeleted, retryLastMutation, runMutation, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleDelete()
    }
  }, [handleDelete])

  return (
    <Dialog open={email !== null} onOpenChange={(open) => { if (!open && !isDeleting) onClose() }}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('inbox_ops.emails.delete.title', 'Delete email?')}</DialogTitle>
          <DialogDescription>
            {t(
              'inbox_ops.emails.delete.description',
              'The email "{subject}" is removed from the inbox and its attachments are deleted. This cannot be undone.',
              { subject: email?.subject || t('inbox_ops.emails.delete.untitled', 'Untitled email') },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isDeleting}>
            {t('ui.actions.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive-solid" onClick={() => void handleDelete()} disabled={isDeleting}>
            {isDeleting ? <Spinner size="sm" /> : null}
            {t('inbox_ops.emails.delete.confirm', 'Delete email')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
