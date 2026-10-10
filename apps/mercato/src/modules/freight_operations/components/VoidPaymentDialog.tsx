"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { formatFreightAmount } from './freightOptions'

const CONTEXT_ID = 'freight_operations.payments.void'

export type VoidablePayment = {
  id: string
  amount: string
  currency_code?: string | null
  reference?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

/**
 * Voiding is the only correction path a payment has — the row is never edited
 * or deleted — and it is guarded by the *payment's* own version, not the
 * invoice's.
 */
export function VoidPaymentDialog({
  payment,
  onOpenChange,
  onVoided,
}: {
  payment: VoidablePayment | null
  onOpenChange: (open: boolean) => void
  onVoided: () => void
}) {
  const t = useT()
  const open = payment !== null
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!payment) return
    setReason('')
    setError(null)
  }, [payment])

  const submit = React.useCallback(async () => {
    if (!payment) return
    if (!reason.trim()) {
      setError(t('freight_operations.payments.void.reasonRequired', 'A reason is required.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(payment.updatedAt ?? payment.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/payments/void', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: payment.id, reason: reason.trim() }),
          }, { errorMessage: t('freight_operations.errors.payment_void_failed', 'Unable to void the payment.') }),
        ),
        mutationPayload: { operation: 'payments.void', id: payment.id, updatedAt: payment.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_payment', resourceId: payment.id, retryLastMutation },
      })
      flash(t('freight_operations.payments.void.success', 'Payment voided.'), 'success')
      onVoided()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.payments.void.error', 'Unable to void the payment.'))
    }
  }, [onVoided, payment, reason, retryLastMutation, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.payments.void.title', 'Void payment')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.payments.void.description', 'Voids {amount} and returns the invoice totals to what is still recorded.', {
              amount: payment ? formatFreightAmount(payment.amount, payment.currency_code ?? 'SAR') : '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.payments.void.reason', 'Reason')}</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.payments.void.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => { void submit() }}>
            {t('freight_operations.payments.void.submit', 'Void payment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
