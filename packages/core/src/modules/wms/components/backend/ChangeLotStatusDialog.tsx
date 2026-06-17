"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const LOT_STATUSES = ['available', 'hold', 'quarantine', 'expired'] as const
type LotStatus = (typeof LOT_STATUSES)[number]

type ChangeLotStatusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: ReturnType<typeof useWmsInventoryMutationAccess>
  lotId: string
  currentStatus: string | null | undefined
  lotUpdatedAt?: string | null
  onSuccess?: () => void
}

const formSchema = z.object({
  status: z.enum(LOT_STATUSES),
  notes: z.string().trim().max(500).optional(),
})

export function ChangeLotStatusDialog({
  open,
  onOpenChange,
  access,
  lotId,
  currentStatus,
  lotUpdatedAt,
  onSuccess,
}: ChangeLotStatusDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-lot-change-status',
  })
  const mutationContext = React.useMemo(() => ({ retryLastMutation }), [retryLastMutation])

  const safeCurrentStatus = LOT_STATUSES.includes(currentStatus as LotStatus)
    ? (currentStatus as LotStatus)
    : 'available'

  const [status, setStatus] = React.useState<LotStatus>(safeCurrentStatus)
  const [notes, setNotes] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setStatus(safeCurrentStatus)
      setNotes('')
      setFieldErrors({})
    }
  }, [open, safeCurrentStatus])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const statusLabel = React.useCallback(
    (s: LotStatus) => {
      const fallbacks: Record<LotStatus, string> = {
        available: 'Available',
        hold: 'On hold',
        quarantine: 'Quarantine',
        expired: 'Expired',
      }
      return t(`wms.backend.lot.status.${s}`, fallbacks[s])
    },
    [t],
  )

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()

      const parsed = formSchema.safeParse({ status, notes: notes.trim() || undefined })
      if (!parsed.success) {
        const nextErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form')
          if (!nextErrors[key]) nextErrors[key] = issue.message
        }
        setFieldErrors(nextErrors)
        return
      }

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

      setSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          id: lotId,
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          status: parsed.data.status,
        }
        if (parsed.data.notes) payload.notes = parsed.data.notes

        let conflictHandled = false
        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean }>(
              '/api/wms/lots',
              {
                method: 'PUT',
                headers: {
                  'content-type': 'application/json',
                  ...buildOptimisticLockHeader(lotUpdatedAt ?? undefined),
                },
                body: JSON.stringify(payload),
              },
            )
            if (!call.ok) {
              if (surfaceRecordConflict({ status: call.status, body: call.result }, t)) {
                conflictHandled = true
                return {}
              }
              await raiseCrudError(
                call.response,
                t('wms.backend.lot.changeStatus.errors.submit', 'Failed to update lot status.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        if (conflictHandled) return

        flash(t('wms.backend.lot.changeStatus.flash.success', 'Lot status updated'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-lot-detail'] })
        closeDialog()
        onSuccess?.()
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      closeDialog,
      lotId,
      lotUpdatedAt,
      mutationContext,
      notes,
      onSuccess,
      queryClient,
      runMutation,
      status,
      t,
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

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden p-0"
        onKeyDown={handleKeyDown}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>
              {t('wms.backend.lot.changeStatus.dialog.title', 'Change lot status')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.lot.changeStatus.dialog.description',
                'Update the quality/hold state for this lot. The change is recorded immediately.',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 px-6 py-6">
            <FormField
              label={t('wms.backend.lot.changeStatus.form.status', 'New status')}
              required
              error={fieldErrors.status}
            >
              <Select
                value={status}
                onValueChange={(next) => {
                  setStatus(next as LotStatus)
                  setFieldErrors({})
                }}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label={t('wms.backend.lot.changeStatus.form.notes', 'Notes')}
              error={fieldErrors.notes}
            >
              <Textarea
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value)
                  setFieldErrors({})
                }}
                placeholder={t(
                  'wms.backend.lot.changeStatus.form.notesPlaceholder',
                  'Optional reason for the status change',
                )}
                rows={2}
                disabled={submitting}
              />
            </FormField>
          </div>

          <DialogFooter className="flex-row items-center justify-between border-t px-6 py-4">
            <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>/</span>
              <KbdShortcut keys={['Ctrl', 'Enter']} />
              <span>{t('wms.backend.lot.changeStatus.form.shortcut', 'to save')}</span>
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('wms.backend.lot.changeStatus.form.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={submitting || status === safeCurrentStatus}>
                {submitting
                  ? t('wms.backend.lot.changeStatus.form.submitting', 'Saving…')
                  : t('wms.backend.lot.changeStatus.form.submit', 'Update status')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
