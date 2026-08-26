"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
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
import { Input } from '@open-mercato/ui/primitives/input'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  loadBinLocationOptions,
  resolveLocationLabel,
} from './inventoryMutationLoaders'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

export type PutawayTaskTarget = {
  id: string
  warehouseId: string
  quantity: number
  targetLocationId?: string | null
  catalogVariantId?: string | null
  sourceLocationId?: string | null
  updatedAt?: string | null
}

type CompletePutawayTaskDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: WmsInventoryMutationAccess
  task: PutawayTaskTarget | null
  onSuccess?: () => void
}

const formSchema = z.object({
  confirmedQuantity: z.number().positive(),
  targetLocationId: z.string().uuid(),
})

export function CompletePutawayTaskDialog({
  open,
  onOpenChange,
  access,
  task,
  onSuccess,
}: CompletePutawayTaskDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-putaway-complete',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const [confirmedQuantity, setConfirmedQuantity] = React.useState(1)
  const [targetLocationId, setTargetLocationId] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [lockUpdatedAt, setLockUpdatedAt] = React.useState<string | null>(null)
  /** Fresh If-Match after 409; ref so guarded retry reads latest without re-seed. */
  const lockUpdatedAtRef = React.useRef<string | null>(null)

  const closeDialog = React.useCallback(() => {
    if (submitting) return
    onOpenChange(false)
  }, [onOpenChange, submitting])

  React.useEffect(() => {
    if (!open || !task) return
    setConfirmedQuantity(task.quantity > 0 ? task.quantity : 1)
    setTargetLocationId(task.targetLocationId?.trim() || '')
    setFieldErrors({})
    setSubmitting(false)
    const seed = task.updatedAt ?? null
    lockUpdatedAtRef.current = seed
    setLockUpdatedAt(seed)
  }, [open, task])

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (!task) return
      if (!access.scopeReady || !access.organizationId || !access.tenantId || !access.userId) {
        flash(
          t(
            'wms.backend.inventory.mutations.errors.scope',
            'Select an organization and sign in before posting inventory changes.',
          ),
          'error',
        )
        return
      }

      const parsed = formSchema.safeParse({
        confirmedQuantity,
        targetLocationId: targetLocationId.trim(),
      })
      if (!parsed.success) {
        const nextErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form')
          if (!nextErrors[key]) nextErrors[key] = t(issue.message, issue.message)
        }
        setFieldErrors(nextErrors)
        return
      }

      setSubmitting(true)
      setFieldErrors({})
      const payload = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        confirmedQuantity: parsed.data.confirmedQuantity,
        targetLocationId: parsed.data.targetLocationId,
        performedBy: access.userId,
      }

      try {
        let conflictHandled = false
        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean }>(
              `/api/wms/putaway-tasks/${encodeURIComponent(task.id)}/complete`,
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  ...buildOptimisticLockHeader(lockUpdatedAtRef.current ?? undefined),
                },
                body: JSON.stringify(payload),
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
                void queryClient.invalidateQueries({ queryKey: ['wms-putaway-queue'] })
              }
              if (
                surfaceRecordConflict({ status: call.status, body: call.result }, t, {
                  onRefresh: refreshLockFromConflict,
                })
              ) {
                refreshLockFromConflict()
                conflictHandled = true
                return {}
              }
              await raiseCrudError(
                call.response,
                t('wms.backend.putaway.complete.errors.submit', 'Failed to complete putaway task.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        if (conflictHandled) return

        flash(t('wms.backend.putaway.complete.flash.success', 'Putaway completed'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-putaway-queue'] })
        closeDialog()
        onSuccess?.()
      } catch (error) {
        flashMutationError(
          error,
          t('wms.backend.putaway.complete.errors.submit', 'Failed to complete putaway task.'),
          t,
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      closeDialog,
      confirmedQuantity,
      lockUpdatedAt,
      mutationContext,
      onSuccess,
      queryClient,
      runMutation,
      t,
      targetLocationId,
      task,
    ],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!submitting) void handleSubmit()
      }
    },
    [closeDialog, handleSubmit, submitting],
  )

  if (!task) return null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onKeyDown={handleKeyDown}>
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>
              {t('wms.backend.putaway.complete.dialog.title', 'Complete putaway')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.putaway.complete.dialog.description',
                'Confirm quantity and destination bin to move stock from staging.',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <FormField
              label={t('wms.backend.putaway.complete.form.quantity', 'Confirmed quantity')}
              required
              error={fieldErrors.confirmedQuantity}
            >
              <Input
                type="number"
                min={0.0001}
                step="any"
                value={confirmedQuantity}
                onChange={(event) => setConfirmedQuantity(Number(event.target.value))}
                disabled={submitting}
                data-testid="complete-putaway-qty"
              />
            </FormField>

            <FormField
              label={t('wms.backend.putaway.complete.form.target', 'Target location')}
              required
              error={fieldErrors.targetLocationId}
            >
              <ComboboxInput
                value={targetLocationId}
                onChange={setTargetLocationId}
                loadSuggestions={async (query) =>
                  task.warehouseId ? loadBinLocationOptions(task.warehouseId, query) : []
                }
                resolveLabel={async (value) => (await resolveLocationLabel(value)) ?? value}
                placeholder={t(
                  'wms.backend.putaway.complete.form.targetPlaceholder',
                  'Select destination bin',
                )}
                allowCustomValues={false}
                disabled={submitting}
              />
            </FormField>
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />{' '}
              {t('wms.backend.putaway.complete.dialog.shortcutHint', 'to complete')}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('wms.backend.putaway.complete.dialog.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting} data-testid="complete-putaway-submit">
                {t('wms.backend.putaway.complete.dialog.submit', 'Complete putaway')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
