'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

interface DealClosureDialogProps {
  open: boolean
  outcome: 'won' | 'lost'
  onConfirm: (data: { outcome: 'won' | 'lost'; lossReasonId?: string; lossNotes?: string }) => void
  onCancel: () => void
}

interface LossReasonOption {
  id: string
  value: string
  label: string
}

export function DealClosureDialog({ open, outcome, onConfirm, onCancel }: DealClosureDialogProps) {
  const t = useT()
  const [lossReasonId, setLossReasonId] = React.useState('')
  const [lossNotes, setLossNotes] = React.useState('')
  const [lossReasons, setLossReasons] = React.useState<LossReasonOption[]>([])
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!open || outcome !== 'lost') return
    let cancelled = false
    loadDictionaryEntriesByKey('sales.deal_loss_reason')
      .then((items) => {
        if (cancelled) return
        setLossReasons(items)
      })
      .catch((error) => {
        console.error('sales.closure.lossReasons failed', error)
        if (!cancelled) setLossReasons([])
      })
    return () => { cancelled = true }
  }, [open, outcome])

  React.useEffect(() => {
    if (open) {
      setLossReasonId('')
      setLossNotes('')
      setError('')
    }
  }, [open])

  const handleConfirm = React.useCallback(() => {
    if (outcome === 'lost' && !lossReasonId) {
      setError(t('sales.closure.lossReasonRequired', 'Please select a loss reason'))
      return
    }
    onConfirm({
      outcome,
      lossReasonId: outcome === 'lost' ? lossReasonId : undefined,
      lossNotes: outcome === 'lost' && lossNotes.trim() ? lossNotes.trim() : undefined,
    })
  }, [outcome, lossReasonId, lossNotes, onConfirm, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleConfirm()
      }
    },
    [handleConfirm],
  )

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {outcome === 'won'
              ? t('sales.closure.wonTitle', 'Mark as won?')
              : t('sales.closure.lostTitle', 'Mark as lost')}
          </DialogTitle>
        </DialogHeader>

        {outcome === 'won' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('sales.closure.wonDescription', 'This will mark the deal as won. You can change this later if needed.')}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                {t('sales.closure.cancel', 'Cancel')}
              </Button>
              <Button type="button" variant="default" size="sm" onClick={handleConfirm}>
                {t('sales.closure.confirmWon', 'Confirm Won')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {t('sales.closure.lossReasonLabel', 'Loss reason')}
                <span className="text-destructive ml-0.5">*</span>
              </label>
              <select
                value={lossReasonId}
                onChange={(event) => { setLossReasonId(event.target.value); setError('') }}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('sales.closure.selectReason', 'Select a reason...')}</option>
                {lossReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.label}
                  </option>
                ))}
              </select>
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">
                {t('sales.closure.lossNotesLabel', 'Notes (optional)')}
              </label>
              <textarea
                value={lossNotes}
                onChange={(event) => setLossNotes(event.target.value)}
                placeholder={t('sales.closure.lossNotesPlaceholder', 'Additional details about the loss...')}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[60px] resize-y"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                {t('sales.closure.cancel', 'Cancel')}
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={handleConfirm}>
                {t('sales.closure.confirmLost', 'Confirm Lost')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
