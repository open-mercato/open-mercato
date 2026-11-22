"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Rating } from '@open-mercato/ui/primitives/rating'
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
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function RateDriverDialog({
  order,
  onOpenChange,
  onRated,
}: {
  order: { id: string; orderNumber: string } | null
  onOpenChange: (open: boolean) => void
  onRated: () => void
}) {
  const t = useT()
  const [rating, setRating] = React.useState(0)
  const [comment, setComment] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const open = order !== null

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'freight_operations.portal.rating',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    setRating(0)
    setComment('')
    setError(null)
  }, [open])

  const submit = React.useCallback(async () => {
    if (!order) return
    if (rating < 1) {
      setError(t('freight_operations.portal.orders.rating.required', 'Choose a rating.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await runMutation({
        operation: () => apiCallOrThrow('/api/portal/freight/ratings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            rating,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          }),
        }, {
          errorMessage: t('freight_operations.portal.orders.rating.error', 'Unable to save your rating.'),
        }),
        mutationPayload: { operation: 'portal.freight.rate', orderId: order.id, rating },
        context: {
          formId: 'freight_operations.portal.rating',
          resourceKind: 'freight_operations:freight_driver_rating',
          resourceId: order.id,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.portal.orders.rating.success', 'Thanks for rating your driver.'), 'success')
      onOpenChange(false)
      onRated()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t('freight_operations.portal.orders.rating.error', 'Unable to save your rating.'),
      )
    } finally {
      setSaving(false)
    }
  }, [comment, onOpenChange, onRated, order, rating, retryLastMutation, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
    disabled: saving,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.portal.orders.rating.title', 'Rate your driver')}</DialogTitle>
          <DialogDescription>
            {order
              ? t('freight_operations.portal.orders.rating.description', 'How was the delivery of order {order}?', {
                  order: order.orderNumber,
                })
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Rating
            value={rating}
            onChange={setRating}
            aria-label={t('freight_operations.portal.orders.rating.label', 'Driver rating')}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t('freight_operations.portal.orders.rating.comment', 'Comment (optional)')}
            </span>
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }} disabled={saving}>
            {t('freight_operations.portal.orders.rating.submit', 'Submit rating')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
