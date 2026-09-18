"use client"

import * as React from 'react'
import { z } from 'zod'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { flashMutationError } from '../../lib/flashMutationError'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  buildOptimisticLockHeader,
  extractOptimisticLockConflict,
} from '@open-mercato/ui/backend/utils/optimisticLock'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  loadAssigneeOptions,
  resolveAssigneeLabel,
} from './inventoryMutationLoaders'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

export type PutawayAssignTarget = {
  id: string
  assignedTo?: string | null
  updatedAt?: string | null
}

type AssignPutawayTaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: WmsInventoryMutationAccess
  task: PutawayAssignTarget | null
  onSuccess?: () => void
  onConflict?: (taskId: string, status: number, body: unknown) => void
}

const formSchema = z.object({
  assignedTo: z.string().uuid(),
})

export function AssignPutawayTaskDialog({
  open,
  onOpenChange,
  access,
  task,
  onSuccess,
  onConflict,
}: AssignPutawayTaskDialogProps) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-putaway-assign',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const [assignedTo, setAssignedTo] = React.useState('')
  const [optionLabels, setOptionLabels] = React.useState<Record<string, string>>({})
  const [canListUsers, setCanListUsers] = React.useState(true)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [lockUpdatedAt, setLockUpdatedAt] = React.useState<string | null>(null)
  const lockUpdatedAtRef = React.useRef<string | null>(null)

  const assigneeFallback = React.useMemo(() => {
    const userId = access.userId?.trim()
    if (!userId) return undefined
    return {
      userId,
      label: t('wms.backend.putaway.assignee.me', 'Me'),
    }
  }, [access.userId, t])

  const closeDialog = React.useCallback(() => {
    if (submitting) return
    onOpenChange(false)
  }, [onOpenChange, submitting])

  const registerOptionLabels = React.useCallback((options: Array<{ value: string; label: string }>) => {
    setOptionLabels((prev) => {
      const next = { ...prev }
      for (const option of options) {
        next[option.value] = option.label
      }
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!open || !task) return
    const seedAssignee = task.assignedTo?.trim() || access.userId?.trim() || ''
    setAssignedTo(seedAssignee)
    setFieldErrors({})
    setSubmitting(false)
    const seed = task.updatedAt ?? null
    lockUpdatedAtRef.current = seed
    setLockUpdatedAt(seed)
    if (assigneeFallback) {
      void loadAssigneeOptions(undefined, assigneeFallback).then((result) => {
        setCanListUsers(result.canListUsers)
        registerOptionLabels(result.options)
      })
    }
  }, [access.userId, assigneeFallback, open, registerOptionLabels, task])

  const resolveOptionLabel = React.useCallback(
    (value: string) => {
      if (!value) return ''
      if (value === access.userId) return t('wms.backend.putaway.assignee.me', 'Me')
      return optionLabels[value] || value
    },
    [access.userId, optionLabels, t],
  )

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (!task) return
      if (!access.scopeReady || !access.organizationId || !access.tenantId) {
        flash(
          t(
            'wms.backend.inventory.mutations.errors.scope',
            'Select an organization and sign in before posting inventory changes.',
          ),
          'error',
        )
        return
      }

      const parsed = formSchema.safeParse({ assignedTo: assignedTo.trim() })
      if (!parsed.success) {
        setFieldErrors({
          assignedTo: t('wms.backend.putaway.assign.errors.assignee', 'Select an assignee.'),
        })
        return
      }
      setFieldErrors({})
      setSubmitting(true)

      try {
        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean }>(
              `/api/wms/putaway-tasks/${encodeURIComponent(task.id)}/assign`,
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  ...buildOptimisticLockHeader(lockUpdatedAtRef.current ?? undefined),
                },
                body: JSON.stringify({
                  organizationId: access.organizationId,
                  tenantId: access.tenantId,
                  assignedTo: parsed.data.assignedTo,
                }),
              },
            )
            if (!call.ok) {
              const refreshLockFromConflict = () => {
                const conflict = extractOptimisticLockConflict({
                  status: call.status,
                  body: call.result,
                })
                if (conflict?.currentUpdatedAt) {
                  lockUpdatedAtRef.current = conflict.currentUpdatedAt
                  setLockUpdatedAt(conflict.currentUpdatedAt)
                }
                onConflict?.(task.id, call.status, call.result)
              }
              if (
                surfaceRecordConflict({ status: call.status, body: call.result }, t, {
                  onRefresh: refreshLockFromConflict,
                })
              ) {
                refreshLockFromConflict()
                return {}
              }
              await raiseCrudError(
                call.response,
                t('wms.backend.putaway.errors.action', 'Failed to update putaway task.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: { assignedTo: parsed.data.assignedTo },
        })
        flash(t('wms.backend.putaway.flash.assigned', 'Putaway task assigned'), 'success')
        onSuccess?.()
        closeDialog()
      } catch (error) {
        flashMutationError(error, t('wms.backend.putaway.errors.action', 'Failed to update putaway task.'), t)
      } finally {
        setSubmitting(false)
      }
    },
    [
      access.organizationId,
      access.scopeReady,
      access.tenantId,
      assignedTo,
      closeDialog,
      mutationContext,
      onConflict,
      onSuccess,
      runMutation,
      t,
      task,
    ],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !submitting) {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [closeDialog, handleSubmit, submitting],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onKeyDown={handleKeyDown}>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>{t('wms.backend.putaway.assign.dialog.title', 'Assign putaway task')}</DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.putaway.assign.dialog.description',
                'Choose who should complete this putaway task.',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-4">
            <FormField
              label={t('wms.backend.putaway.columns.assignee', 'Assignee')}
              required
              error={fieldErrors.assignedTo}
            >
              {canListUsers ? (
                <ComboboxInput
                  value={assignedTo}
                  onChange={(next) => setAssignedTo(next.trim())}
                  loadSuggestions={async (query) => {
                    const result = await loadAssigneeOptions(query, assigneeFallback)
                    setCanListUsers(result.canListUsers)
                    registerOptionLabels(result.options)
                    return result.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))
                  }}
                  resolveLabel={(value) => {
                    const known = resolveOptionLabel(value)
                    if (known && known !== value) return known
                    return resolveAssigneeLabel(value).then((label) => label ?? value)
                  }}
                  placeholder={t(
                    'wms.backend.putaway.assign.dialog.assigneePlaceholder',
                    'Select assignee',
                  )}
                  allowCustomValues={false}
                  disabled={submitting}
                />
              ) : (
                <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
                  {resolveOptionLabel(assignedTo) || assignedTo}
                </div>
              )}
              {!canListUsers ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'wms.backend.putaway.assign.dialog.assigneeLocked',
                    'Only the current user can be assigned without user-directory access.',
                  )}
                </p>
              ) : null}
            </FormField>
            {lockUpdatedAt ? (
              <span className="sr-only" data-testid="assign-putaway-lock-token">
                {lockUpdatedAt}
              </span>
            ) : null}
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('ui.actions.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting || !assignedTo.trim()}>
                {t('wms.backend.putaway.actions.assign', 'Assign')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
