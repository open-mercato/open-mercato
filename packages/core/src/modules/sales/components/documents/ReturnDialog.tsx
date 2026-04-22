"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

export type ReturnOrderLine = {
  id: string
  title: string
  lineNumber: number | null
  quantity: number
  returnedQuantity: number
  thumbnail?: string | null
}

type ReturnDialogProps = {
  open: boolean
  orderId: string
  lines: ReturnOrderLine[]
  onClose: () => void
  onSaved: () => Promise<void>
}

const normalizeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function ReturnDialog({ open, orderId, lines, onClose, onSaved }: ReturnDialogProps) {
  const t = useT()
  const { runMutation } = useGuardedMutation({ contextId: `sales-returns-${orderId}` })
  const [reason, setReason] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [quantities, setQuantities] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const availableLines = React.useMemo(() => {
    return lines
      .map((line) => {
        const available = Math.max(0, line.quantity - line.returnedQuantity)
        return { ...line, available }
      })
      .filter((line) => line.available > 0)
  }, [lines])

  React.useEffect(() => {
    if (!open) return
    setReason('')
    setNotes('')
    setQuantities({})
  }, [open])

  const submit = React.useCallback(async () => {
    if (saving) return
    let hasInvalidQuantity = false
    const linesForRequest: Array<{ orderLineId: string; quantity: string }> = []
    availableLines.forEach((line) => {
      const raw = quantities[line.id]
      const qty = normalizeNumber(raw)
      if (!Number.isFinite(qty) || qty <= 0) return
      if (qty - 1e-6 > line.available) {
        hasInvalidQuantity = true
        return
      }
      linesForRequest.push({ orderLineId: line.id, quantity: qty.toString() })
    })

    if (hasInvalidQuantity) {
      flash(t('sales.returns.errors.quantityExceeded', 'Cannot return more than available quantity.'), 'error')
      return
    }

    if (!linesForRequest.length) {
      flash(t('sales.returns.errors.linesRequired', 'Select at least one line to return.'), 'error')
      return
    }

    setSaving(true)
    try {
      await runMutation({
        context: { kind: 'order', record: { id: orderId } },
        mutationPayload: { orderId, lines: linesForRequest, reason, notes },
        operation: async () => {
          const response = await apiCallOrThrow<{ id: string | null }>(
            '/api/sales/returns',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                orderId,
                lines: linesForRequest,
                ...(reason.trim().length ? { reason: reason.trim() } : {}),
                ...(notes.trim().length ? { notes: notes.trim() } : {}),
              }),
            },
            { errorMessage: t('sales.returns.errors.create', 'Failed to create return.') },
          )
          return response.result?.id ?? null
        },
      })
      flash(t('sales.returns.created', 'Return created.'), 'success')
      onClose()
      await onSaved()
    } catch {
      flash(t('sales.returns.errors.create', 'Failed to create return.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [availableLines, notes, onClose, onSaved, orderId, quantities, reason, runMutation, saving, t])

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    },
    [onClose, submit],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent onKeyDown={onKeyDown} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('sales.returns.create.title', 'Create return')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('sales.returns.create.lines', 'Lines')}</div>
            {!availableLines.length ? (
              <div className="text-sm text-muted-foreground">{t('sales.returns.empty.available', 'No items available to return.')}</div>
            ) : (
              <div className="max-h-[280px] overflow-auto rounded-md border">
                <div className="divide-y">
                  {availableLines.map((line) => {
                    const value = quantities[line.id] ?? ''
                    return (
                      <div key={line.id} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {line.lineNumber ? `#${line.lineNumber} · ` : ''}
                            {line.title}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t('sales.returns.available', 'Available')}: {line.available}
                          </div>
                        </div>
                        <div className="w-32">
                          <Label className="sr-only" htmlFor={`return-qty-${line.id}`}>
                            {t('sales.returns.quantity', 'Quantity')}
                          </Label>
                          <Input
                            id={`return-qty-${line.id}`}
                            inputMode="decimal"
                            placeholder="0"
                            value={value}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="return-reason">{t('sales.returns.reason', 'Reason')}</Label>
              <Input
                id="return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('sales.returns.reason.placeholder', 'Optional')}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="return-notes">{t('sales.returns.notes', 'Notes')}</Label>
              <Textarea
                id="return-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('sales.returns.notes.placeholder', 'Optional')}
                rows={3}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={submit} disabled={saving || !availableLines.length}>
              {saving ? t('common.saving', 'Saving…') : t('sales.returns.create.submit', 'Create return')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

