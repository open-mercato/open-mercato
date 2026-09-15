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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  loadStagingLocationOptions,
  resolveLocationLabel,
} from './inventoryMutationLoaders'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

export type ReceiveAsnLineTarget = {
  lineId: string
  catalogVariantId: string
  expectedQty: number
  receivedQty: number
  lotNumber?: string | null
  targetStagingLocationId?: string | null
  variantLabel?: string | null
  updatedAt?: string | null
  asnUpdatedAt?: string | null
}

type ReceiveAsnLineDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: WmsInventoryMutationAccess
  asnId: string
  warehouseId: string
  line: ReceiveAsnLineTarget | null
  onSuccess?: (result?: { receivedQty: number; asnUpdatedAt?: string | null }) => void
}

const formSchema = z
  .object({
    receivedQty: z.number().positive(),
    qcStatus: z.enum(['passed', 'failed']),
    targetStagingLocationId: z.string().uuid().optional(),
    lotNumber: z.string().trim().max(120).optional(),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.qcStatus === 'passed' && !value.targetStagingLocationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetStagingLocationId'],
        message: 'wms.backend.asns.receive.errors.stagingRequired',
      })
    }
    if (value.qcStatus === 'failed' && !value.rejectionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: 'wms.backend.asns.receive.errors.rejectionRequired',
      })
    }
  })

export function ReceiveAsnLineDialog({
  open,
  onOpenChange,
  access,
  asnId,
  warehouseId,
  line,
  onSuccess,
}: ReceiveAsnLineDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-asn-receive-line',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const remaining = Math.max(0, (line?.expectedQty ?? 0) - (line?.receivedQty ?? 0))
  const [baselineReceivedQty, setBaselineReceivedQty] = React.useState(line?.receivedQty ?? 0)
  const [receivedQty, setReceivedQty] = React.useState(1)
  const [qcStatus, setQcStatus] = React.useState<'passed' | 'failed'>('passed')
  const [targetStagingLocationId, setTargetStagingLocationId] = React.useState('')
  const [lotNumber, setLotNumber] = React.useState('')
  const [rejectionReason, setRejectionReason] = React.useState('')
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
    if (!open || !line) return
    setBaselineReceivedQty(line.receivedQty)
    setReceivedQty(remaining > 0 ? remaining : 1)
    setQcStatus('passed')
    setTargetStagingLocationId(line.targetStagingLocationId?.trim() || '')
    setLotNumber(line.lotNumber?.trim() || '')
    setRejectionReason('')
    setFieldErrors({})
    setSubmitting(false)
    const seed = line.asnUpdatedAt ?? line.updatedAt ?? null
    lockUpdatedAtRef.current = seed
    setLockUpdatedAt(seed)
  }, [line, open, remaining])

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (!line) return
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
        receivedQty,
        qcStatus,
        targetStagingLocationId: targetStagingLocationId.trim() || undefined,
        lotNumber: lotNumber.trim() || undefined,
        rejectionReason: rejectionReason.trim() || undefined,
      })
      if (!parsed.success) {
        const nextErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form')
          if (!nextErrors[key]) {
            nextErrors[key] = t(issue.message, issue.message)
          }
        }
        setFieldErrors(nextErrors)
        return
      }

      setSubmitting(true)
      setFieldErrors({})
      const targetReceivedQty = baselineReceivedQty + parsed.data.receivedQty
      const payload: Record<string, unknown> = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        lineId: line.lineId,
        receivedQty: parsed.data.receivedQty,
        targetReceivedQty,
        qcStatus: parsed.data.qcStatus,
        performedBy: access.userId,
      }
      if (parsed.data.targetStagingLocationId) {
        payload.targetStagingLocationId = parsed.data.targetStagingLocationId
      }
      if (parsed.data.lotNumber) payload.lotNumber = parsed.data.lotNumber
      if (parsed.data.rejectionReason) payload.rejectionReason = parsed.data.rejectionReason

      try {
        let conflictHandled = false
        let mutationResult: {
          ok?: boolean
          receivedQty?: number
          asnUpdatedAt?: string
        } = {}
        await runMutation({
          operation: async () => {
            const call = await apiCall<{
              ok?: boolean
              receivedQty?: number
              asnUpdatedAt?: string
            }>(
              `/api/wms/asns/${encodeURIComponent(asnId)}/receive`,
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
                void queryClient.invalidateQueries({ queryKey: ['wms-asn-detail'] })
                void queryClient.invalidateQueries({ queryKey: ['wms-asns-list'] })
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
                t('wms.backend.asns.receive.errors.submit', 'Failed to receive ASN line.'),
              )
            }
            mutationResult = call.result ?? {}
            return mutationResult
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        if (conflictHandled) return

        const nextReceivedQty =
          typeof mutationResult.receivedQty === 'number'
            ? mutationResult.receivedQty
            : targetReceivedQty
        setBaselineReceivedQty(nextReceivedQty)
        if (mutationResult.asnUpdatedAt) {
          setLockUpdatedAt(mutationResult.asnUpdatedAt)
        }

        flash(
          parsed.data.qcStatus === 'failed'
            ? t('wms.backend.asns.receive.flash.qcFailed', 'ASN line recorded with QC fail')
            : t('wms.backend.asns.receive.flash.success', 'ASN line received'),
          'success',
        )
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['wms-asn-detail'] }),
          queryClient.invalidateQueries({ queryKey: ['wms-asns-list'] }),
          queryClient.invalidateQueries({ queryKey: ['wms-putaway-queue'] }),
        ])
        closeDialog()
        onSuccess?.({
          receivedQty: nextReceivedQty,
          asnUpdatedAt: mutationResult.asnUpdatedAt ?? lockUpdatedAt,
        })
      } catch (error) {
        flashMutationError(
          error,
          t('wms.backend.asns.receive.errors.submit', 'Failed to receive ASN line.'),
          t,
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      asnId,
      baselineReceivedQty,
      closeDialog,
      line,
      lockUpdatedAt,
      lotNumber,
      mutationContext,
      onSuccess,
      qcStatus,
      queryClient,
      receivedQty,
      rejectionReason,
      runMutation,
      t,
      targetStagingLocationId,
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

  if (!line) return null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onKeyDown={handleKeyDown}>
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>{t('wms.backend.asns.receive.dialog.title', 'Receive ASN line')}</DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.asns.receive.dialog.description',
                'Record accepted or rejected quantity against the expected ASN line.',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="font-medium">
                {line.variantLabel?.trim() || line.catalogVariantId}
              </div>
              <div className="text-muted-foreground">
                {t('wms.backend.asns.receive.summary.expected', 'Expected')}: {line.expectedQty}
                {' · '}
                {t('wms.backend.asns.receive.summary.received', 'Received')}: {baselineReceivedQty}
              </div>
            </div>

            <FormField
              label={t('wms.backend.asns.receive.form.receivedQty', 'Received quantity')}
              required
              error={fieldErrors.receivedQty}
            >
              <Input
                type="number"
                min={0.0001}
                step="any"
                value={receivedQty}
                onChange={(event) => setReceivedQty(Number(event.target.value))}
                disabled={submitting}
                data-testid="receive-asn-qty"
              />
            </FormField>

            <FormField
              label={t('wms.backend.asns.receive.form.qcStatus', 'QC outcome')}
              required
              error={fieldErrors.qcStatus}
            >
              <Select
                value={qcStatus}
                onValueChange={(value) => setQcStatus(value as 'passed' | 'failed')}
                disabled={submitting}
              >
                <SelectTrigger data-testid="receive-asn-qc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="passed">
                    {t('wms.backend.asns.qc.passed', 'Passed')}
                  </SelectItem>
                  <SelectItem value="failed">
                    {t('wms.backend.asns.qc.failed', 'Failed')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {qcStatus === 'passed' ? (
              <FormField
                label={t('wms.backend.asns.receive.form.staging', 'Staging location')}
                required
                error={fieldErrors.targetStagingLocationId}
              >
                <ComboboxInput
                  value={targetStagingLocationId}
                  onChange={setTargetStagingLocationId}
                  loadSuggestions={async (query) =>
                    warehouseId ? loadStagingLocationOptions(warehouseId, query) : []
                  }
                  resolveLabel={async (value) => (await resolveLocationLabel(value)) ?? value}
                  placeholder={t(
                    'wms.backend.asns.receive.form.stagingPlaceholder',
                    'Select staging or dock',
                  )}
                  allowCustomValues={false}
                  disabled={submitting || !warehouseId}
                />
              </FormField>
            ) : (
              <FormField
                label={t('wms.backend.asns.receive.form.rejectionReason', 'Rejection reason')}
                required
                error={fieldErrors.rejectionReason}
              >
                <Textarea
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  disabled={submitting}
                  rows={3}
                  data-testid="receive-asn-rejection"
                />
              </FormField>
            )}

            <FormField
              label={t('wms.backend.asns.receive.form.lotNumber', 'Lot number')}
              error={fieldErrors.lotNumber}
            >
              <Input
                value={lotNumber}
                onChange={(event) => setLotNumber(event.target.value)}
                disabled={submitting}
              />
            </FormField>
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />{' '}
              {t('wms.backend.asns.receive.dialog.shortcutHint', 'to receive')}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('wms.backend.asns.receive.dialog.cancel', 'Cancel')}
              </Button>
              <Button
                type="submit"
                disabled={submitting || access.loading || !access.scopeReady}
                data-testid="receive-asn-submit"
              >
                {t('wms.backend.asns.receive.dialog.submit', 'Receive line')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
