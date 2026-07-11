"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldOff } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import {
  createInventoryQuantityFormatter,
  formatReservationSourceLabel,
} from '../../lib/inventoryDisplayUi'
import { parseInventoryQuantity } from '../../lib/inventoryMutationUi'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const RELEASE_REASON_CODES = ['order_cancelled', 'manual_release', 'correction', 'other'] as const

type ReleaseReasonCode = (typeof RELEASE_REASON_CODES)[number]

type ReservationSummary = {
  id: string
  warehouse_name?: string | null
  warehouse_code?: string | null
  variant_name?: string | null
  variant_sku?: string | null
  quantity?: string | number | null
  source_type?: string | null
  source_id?: string | null
  source_label?: string | null
  status?: string | null
}

type ReleaseReservationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: WmsInventoryMutationAccess
  reservation: ReservationSummary | null
  onSuccess?: () => void
}

function formatVariantLabel(
  row: ReservationSummary,
  notAvailableLabel: string,
): string {
  const name = (row.variant_name ?? '').trim()
  const sku = (row.variant_sku ?? '').trim()
  if (name && sku) return `${name} (${sku})`
  if (name) return name
  if (sku) return sku
  return notAvailableLabel
}

function formatWarehouseLabel(
  row: ReservationSummary,
  notAvailableLabel: string,
): string {
  return (
    row.warehouse_name?.trim() ||
    row.warehouse_code?.trim() ||
    notAvailableLabel
  )
}

export function ReleaseReservationDialog({
  open,
  onOpenChange,
  access,
  reservation,
  onSuccess,
}: ReleaseReservationDialogProps) {
  const t = useT()
  const locale = useLocale()
  const quantityFormatter = React.useMemo(
    () => createInventoryQuantityFormatter(locale),
    [locale],
  )
  const notAvailableLabel = t('wms.backend.inventory.common.notAvailable', '—')
  const queryClient = useQueryClient()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-inventory-release',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )
  const releaseFormSchema = React.useMemo(
    () =>
      z.object({
        reasonCode: z.enum(RELEASE_REASON_CODES),
        notes: z.string().trim().max(500).optional(),
      }),
    [],
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [reasonCode, setReasonCode] = React.useState<ReleaseReasonCode | ''>('')
  const [notes, setNotes] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  const reasonLabel = React.useCallback(
    (code: ReleaseReasonCode) => {
      const fallbacks: Record<ReleaseReasonCode, string> = {
        order_cancelled: 'Order cancelled',
        manual_release: 'Manual release',
        correction: 'Correction',
        other: 'Other',
      }
      return t(`wms.backend.inventory.release.reasons.${code}`, fallbacks[code])
    },
    [t],
  )

  const resetDialog = React.useCallback(() => {
    setReasonCode('')
    setNotes('')
    setFieldErrors({})
    setSubmitting(false)
  }, [])

  React.useEffect(() => {
    if (!open || !reservation?.id) return
    setReasonCode('manual_release')
    setNotes('')
    setFieldErrors({})
    setSubmitting(false)
  }, [open, reservation?.id])

  const closeDialog = React.useCallback(() => {
    onOpenChange(false)
    resetDialog()
  }, [onOpenChange, resetDialog])

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (!reservation?.id) {
        flash(
          t(
            'wms.backend.inventory.release.errors.missingReservation',
            'Reservation context is missing. Close the dialog and try again from the reservations table.',
          ),
          'error',
        )
        return
      }

      const parsed = releaseFormSchema.safeParse({
        reasonCode,
        notes: notes.trim() || undefined,
      })
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
        const reasonParts = [reasonLabel(parsed.data.reasonCode)]
        if (parsed.data.notes?.trim()) reasonParts.push(parsed.data.notes.trim())
        const payload = {
          organizationId: access.organizationId,
          tenantId: access.tenantId,
          reservationId: reservation.id,
          reason: reasonParts.join(' — ').slice(0, 120),
          reasonCode: parsed.data.reasonCode,
        }

        await runMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean }>('/api/wms/inventory/release', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!call.ok) {
              if (call.response.status === 409 && (call.result as { error?: string } | null)?.error === 'balance_integrity_violation') {
                flash(
                  t(
                    'wms.backend.inventory.release.errors.balanceIntegrityViolation',
                    'Balance integrity error — run "mercato wms verify-balances --repair" to diagnose and fix drift before retrying.',
                  ),
                  'error',
                )
                return {}
              }
              await raiseCrudError(
                call.response,
                t('wms.backend.inventory.release.errors.submit', 'Failed to release reservation.'),
              )
            }
            return call.result ?? {}
          },
          context: mutationContext,
          mutationPayload: payload,
        })

        flash(t('wms.backend.inventory.release.flash.success', 'Reservation released'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['wms-inventory-console'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-sku-detail'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-location-detail'] })
        await queryClient.invalidateQueries({ queryKey: ['wms-lot-detail'] })
        closeDialog()
        onSuccess?.()
      } catch (error) {
        flash(
          error instanceof Error
            ? error.message
            : t('wms.backend.inventory.release.errors.submit', 'Failed to release reservation.'),
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      access,
      closeDialog,
      mutationContext,
      notes,
      onSuccess,
      queryClient,
      reasonCode,
      reasonLabel,
      releaseFormSchema,
      reservation,
      runMutation,
      t,
    ],
  )

  const submitDisabled = submitting || access.loading || !access.scopeReady

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!submitDisabled) void handleSubmit()
      }
    },
    [closeDialog, handleSubmit, submitDisabled],
  )

  if (!reservation) return null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle>
              {t('wms.backend.inventory.release.dialog.title', 'Release reservation')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'wms.backend.inventory.release.dialog.description',
                'Return reserved quantity to available stock for this bucket.',
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
            <div className="rounded-lg border bg-muted/40 px-4 py-3.5">
              <div className="flex items-start gap-3">
                <ShieldOff className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <dl className="grid gap-2 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">
                      {t('wms.backend.inventory.release.summary.variant', 'Variant')}
                    </dt>
                    <dd className="font-medium">
                      {formatVariantLabel(reservation, notAvailableLabel)}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">
                      {t('wms.backend.inventory.release.summary.warehouse', 'Warehouse')}
                    </dt>
                    <dd className="font-medium">
                      {formatWarehouseLabel(reservation, notAvailableLabel)}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">
                      {t('wms.backend.inventory.release.summary.quantity', 'Quantity')}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {quantityFormatter.format(parseInventoryQuantity(reservation.quantity))}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">
                      {t('wms.backend.inventory.release.summary.source', 'Source')}
                    </dt>
                    <dd className="font-medium">
                      {formatReservationSourceLabel(reservation, t) || notAvailableLabel}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <p className="rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2.5 text-sm text-status-warning-text">
              {t(
                'wms.backend.inventory.release.warning',
                'This action cannot be undone — the reserved quantity will be released immediately.',
              )}
            </p>

            <FormField
              label={t('wms.backend.inventory.release.form.reason', 'Reason')}
              required
              error={fieldErrors.reasonCode}
            >
              <Select
                value={reasonCode || undefined}
                onValueChange={(next) => {
                  setReasonCode(next as ReleaseReasonCode)
                  setFieldErrors({})
                }}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      'wms.backend.inventory.release.form.reasonPlaceholder',
                      'Select reason',
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {RELEASE_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {reasonLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label={t('wms.backend.inventory.release.form.notes', 'Notes')}>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t(
                  'wms.backend.inventory.release.form.notesPlaceholder',
                  'Optional — additional context',
                )}
                rows={3}
                disabled={submitting}
              />
            </FormField>
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1.5">
              <KbdShortcut keys={['⌘', 'Enter']} />
              <span>/</span>
              <KbdShortcut keys={['Ctrl', 'Enter']} />
              <span>{t('wms.backend.inventory.release.dialog.shortcutSave', 'to confirm')}</span>
            </p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={submitDisabled}
                data-testid="wms-inventory-release-submit"
              >
                {t('wms.backend.inventory.release.dialog.submit', 'Release reservation')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
