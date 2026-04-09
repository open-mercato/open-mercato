'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

interface DealClosureDialogProps {
  open: boolean
  outcome: 'won' | 'lost'
  dealLabel?: string
  onConfirm: (data: { outcome: 'won' | 'lost'; lossReasonId?: string; lossNotes?: string }) => void
  onCancel: () => void
}

interface LossReasonOption {
  id: string
  value: string
  label: string
  description?: string | null
}

export function DealClosureDialog({ open, outcome, dealLabel, onConfirm, onCancel }: DealClosureDialogProps) {
  const t = useT()
  const [lossReasonId, setLossReasonId] = React.useState('')
  const [lossNotes, setLossNotes] = React.useState('')
  const [lossReasons, setLossReasons] = React.useState<LossReasonOption[]>([])
  const [error, setError] = React.useState('')
  const [reasonListOpen, setReasonListOpen] = React.useState(false)

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
      setReasonListOpen(false)
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

  const selectedLossReason = React.useMemo(
    () => lossReasons.find((reason) => reason.id === lossReasonId) ?? null,
    [lossReasonId, lossReasons],
  )

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent
        className={outcome === 'lost' ? 'sm:max-w-[620px] overflow-hidden p-0' : 'sm:max-w-md'}
        onKeyDown={handleKeyDown}
      >
        {outcome === 'lost' ? (
          <div className="overflow-hidden rounded-[20px] bg-card">
            <DialogHeader className="border-b border-border/70 px-7 py-6">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-destructive/10 text-destructive">
                  <AlertTriangle className="size-5" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[28px] font-semibold leading-none tracking-tight">
                    {t('sales.closure.lostTitle', 'Mark deal as Lost?')}
                  </DialogTitle>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {dealLabel
                      ? t('sales.closure.dealContext', '{{label}}', { label: dealLabel })
                      : t('sales.closure.lostDescription', 'This deal will be marked as lost.')}
                  </p>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-6 px-7 py-6">
              <div className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-950">
                    {t('sales.closure.warningTitle', 'This action closes the deal')}
                  </p>
                  <p className="mt-1 text-amber-800">
                    {t('sales.closure.warningDescription', "Stage will be set to 'Lost' and cannot be reversed without 'sales.reopen' permission.")}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {t('sales.closure.lossReasonLabel', 'Loss reason')}
                  <span className="ml-1 text-destructive">*</span>
                </label>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setReasonListOpen((current) => !current)}
                    className="flex w-full items-center justify-between rounded-[12px] border border-foreground bg-background px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-foreground">
                        {selectedLossReason?.label ?? t('sales.closure.lossReasonPlaceholder', 'Select loss reason')}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {selectedLossReason?.description ?? t('sales.closure.lossReasonHelp', 'Choose the closest reason from the dictionary.')}
                      </div>
                    </div>
                    <ChevronDown className="ml-3 size-4 shrink-0 text-muted-foreground" />
                  </button>

                  {reasonListOpen ? (
                    <div className="overflow-hidden rounded-[12px] border border-border/80 bg-background">
                      {lossReasons.map((reason, index) => {
                        const isSelected = reason.id === lossReasonId
                        return (
                          <button
                            key={reason.id}
                            type="button"
                            onClick={() => {
                              setLossReasonId(reason.id)
                              setError('')
                              setReasonListOpen(false)
                            }}
                            className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                              index < lossReasons.length - 1 ? 'border-b border-border/60' : ''
                            } ${isSelected ? 'bg-muted/60' : 'hover:bg-accent/50'}`}
                          >
                            <div className="min-w-0">
                              <div className="text-base font-semibold text-foreground">{reason.label}</div>
                              <div className="text-sm text-muted-foreground">
                                {reason.description ?? t('sales.closure.lossReasonFallbackDescription', 'No description available.')}
                              </div>
                            </div>
                            {isSelected ? (
                              <span className="ml-3 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                                <Check className="size-3.5" />
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {t('sales.closure.lossNotesLabel', 'Loss notes (optional)')}
                </label>
                <Textarea
                  value={lossNotes}
                  onChange={(event) => setLossNotes(event.target.value)}
                  placeholder={t('sales.closure.lossNotesPlaceholder', 'Additional details about the loss...')}
                  className="min-h-[120px] rounded-[12px] border-border/80 px-4 py-3 shadow-none"
                  rows={4}
                />
              </div>
            </div>

            <DialogFooter className="border-t border-border/70 px-7 py-4 sm:justify-end">
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('sales.closure.cancel', 'Cancel')}
              </Button>
              <Button type="button" variant="destructive" onClick={handleConfirm}>
                {t('sales.closure.confirmLost', 'Mark as Lost')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('sales.closure.wonTitle', 'Mark as won?')}
              </DialogTitle>
            </DialogHeader>

            <div>
              <p className="text-sm text-muted-foreground">
                {t('sales.closure.wonDescription', 'This will mark the deal as won. You can change this later if needed.')}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                  {t('sales.closure.cancel', 'Cancel')}
                </Button>
                <Button type="button" onClick={handleConfirm}>
                  {t('sales.closure.confirmWon', 'Confirm Won')}
                </Button>
              </DialogFooter>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
