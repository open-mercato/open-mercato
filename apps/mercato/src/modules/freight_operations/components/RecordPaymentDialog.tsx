"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
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
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { PAYMENT_METHOD_FALLBACKS, PAYMENT_METHOD_VALUES } from '../lib/freightEnums'

const CONTEXT_ID = 'freight_operations.payments.record'

export type PaymentTargetKind = 'order' | 'abstract'

export type PaymentTargetOption = {
  value: string
  label: string
  updatedAt: string | null
  currencyCode: string
}

/**
 * A payment records against an *invoiced* document and is guarded by that
 * document's version — so the picker options carry the version with them and the
 * dialog never has to re-read the record before submitting.
 */
export function useInvoicedTargetOptions(kind: PaymentTargetKind, enabled: boolean): PaymentTargetOption[] {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-invoiced-targets', kind, scopeVersion],
    enabled,
    queryFn: async (): Promise<PaymentTargetOption[]> => {
      const path = kind === 'order'
        ? '/api/freight_operations/orders?status=invoiced&pageSize=100'
        : '/api/freight_operations/abstracts?status=invoiced&pageSize=100'
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(path)
      return (call.result?.items ?? []).flatMap((raw) => {
        const id = typeof raw.id === 'string' ? raw.id : null
        if (!id) return []
        const number = kind === 'order'
          ? (typeof raw.order_number === 'string' ? raw.order_number : id)
          : (typeof raw.abstract_number === 'string' ? raw.abstract_number : id)
        const outstanding = raw.outstanding_amount
        const label = typeof outstanding === 'string' || typeof outstanding === 'number'
          ? `${number} · ${outstanding}`
          : number
        return [{
          value: id,
          label,
          updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : (typeof raw.updated_at === 'string' ? raw.updated_at : null),
          currencyCode: typeof raw.currency_code === 'string' ? raw.currency_code : 'SAR',
        }]
      })
    },
    staleTime: 30 * 1000,
  })
  return query.data ?? []
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  onRecorded,
  pinnedTarget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecorded: () => void
  /** Set when opened from a document's own screen: the target is fixed. */
  pinnedTarget?: { kind: PaymentTargetKind; id: string; updatedAt: string | null; currencyCode: string; label: string } | null
}) {
  const t = useT()
  const [kind, setKind] = React.useState<PaymentTargetKind>(pinnedTarget?.kind ?? 'order')
  const [targetId, setTargetId] = React.useState(pinnedTarget?.id ?? '')
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState('bank_transfer')
  const [reference, setReference] = React.useState('')
  const [receivedAt, setReceivedAt] = React.useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const orderOptions = useInvoicedTargetOptions('order', open && !pinnedTarget && kind === 'order')
  const abstractOptions = useInvoicedTargetOptions('abstract', open && !pinnedTarget && kind === 'abstract')
  const options = kind === 'order' ? orderOptions : abstractOptions
  const pickedOption = options.find((option) => option.value === targetId) ?? null
  const picked = pinnedTarget
    ? { id: pinnedTarget.id, updatedAt: pinnedTarget.updatedAt, currencyCode: pinnedTarget.currencyCode, label: pinnedTarget.label }
    : pickedOption
      ? { id: pickedOption.value, updatedAt: pickedOption.updatedAt, currencyCode: pickedOption.currencyCode, label: pickedOption.label }
      : null

  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    setError(null)
    if (pinnedTarget) {
      setKind(pinnedTarget.kind)
      setTargetId(pinnedTarget.id)
      setReceivedAt(new Date().toISOString().slice(0, 10))
    }
  }, [open, pinnedTarget])

  const submit = React.useCallback(async () => {
    if (!picked) {
      setError(t('freight_operations.payments.dialog.targetRequired', 'Choose the invoiced document the payment belongs to.'))
      return
    }
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(t('freight_operations.payments.dialog.amountRequired', 'Enter an amount greater than zero.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(picked.updatedAt),
          () => apiCallOrThrow('/api/freight_operations/payments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              [kind === 'order' ? 'orderId' : 'abstractId']: picked.id,
              amount,
              method,
              ...(reference.trim() ? { reference: reference.trim() } : {}),
              receivedAt,
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            }),
          }, { errorMessage: t('freight_operations.payments.error.record', 'Unable to record the payment.') }),
        ),
        mutationPayload: { operation: 'payments.record', targetId: picked.id, kind, amount },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_payment', resourceId: picked.id, retryLastMutation },
      })
      flash(t('freight_operations.payments.recorded', 'Payment recorded.'), 'success')
      setAmount('')
      setReference('')
      setNotes('')
      onRecorded()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.payments.error.record', 'Unable to record the payment.'))
    }
  }, [amount, kind, method, notes, onRecorded, picked, receivedAt, reference, retryLastMutation, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.payments.dialog.title', 'Record payment')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.payments.dialog.description', 'Records a bank transfer against an invoiced document and syncs the invoice totals.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {pinnedTarget ? (
            <p className="text-sm text-muted-foreground">
              {t('freight_operations.payments.dialog.target', 'Against')}: {pinnedTarget.label}
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">{t('freight_operations.payments.dialog.targetKind', 'Document type')}</span>
                <Select
                  value={kind}
                  onValueChange={(value) => {
                    setKind(value as PaymentTargetKind)
                    setTargetId('')
                  }}
                >
                  <SelectTrigger aria-label={t('freight_operations.payments.dialog.targetKind', 'Document type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order">{t('freight_operations.payments.dialog.kindOrder', 'Spot order')}</SelectItem>
                    <SelectItem value="abstract">{t('freight_operations.payments.dialog.kindAbstract', 'Trip abstract')}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">{t('freight_operations.payments.dialog.target', 'Against')}</span>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger aria-label={t('freight_operations.payments.dialog.target', 'Against')}>
                    <SelectValue placeholder={t('freight_operations.payments.dialog.targetPlaceholder', 'Choose an invoiced document')} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.payments.form.amount', 'Amount')}</span>
              <Input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.payments.dialog.method', 'Method')}</span>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger aria-label={t('freight_operations.payments.dialog.method', 'Method')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`freight_operations.payments.method.${value}`, PAYMENT_METHOD_FALLBACKS[value] ?? value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.payments.form.reference', 'Bank reference')}</span>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.payments.dialog.receivedAt', 'Received at')}</span>
              <Input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.payments.dialog.notes', 'Notes')}</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.payments.dialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('freight_operations.payments.form.record', 'Record payment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
