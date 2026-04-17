"use client"

import * as React from 'react'
import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

type LossReasonOption = {
  id: string
  value: string
  label: string
  description?: string | null
}

type ConfirmDealLostDialogProps = {
  open: boolean
  dealTitle: string
  dealValue?: string | null
  companyName?: string | null
  onClose: () => void
  onConfirm: (input: { lossReasonId: string; lossNotes?: string }) => void | Promise<void>
}

export function ConfirmDealLostDialog({
  open,
  dealTitle,
  dealValue,
  companyName,
  onClose,
  onConfirm,
}: ConfirmDealLostDialogProps) {
  const t = useT()
  const [lossReasonId, setLossReasonId] = React.useState('')
  const [lossNotes, setLossNotes] = React.useState('')
  const [lossReasons, setLossReasons] = React.useState<LossReasonOption[]>([])
  const [reasonListOpen, setReasonListOpen] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    loadDictionaryEntriesByKey('sales.deal_loss_reason')
      .then((items) => {
        if (!cancelled) setLossReasons(items)
      })
      .catch((loadError) => {
        console.error('customers.deals.detail.lossReasons failed', loadError)
        if (!cancelled) setLossReasons([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    setLossReasonId('')
    setLossNotes('')
    setReasonListOpen(false)
    setError('')
  }, [open])

  const selectedLossReason = React.useMemo(
    () => lossReasons.find((reason) => reason.id === lossReasonId) ?? null,
    [lossReasonId, lossReasons],
  )

  const handleConfirm = React.useCallback(async () => {
    if (!lossReasonId) {
      setError(t('customers.deals.detail.lost.reasonRequired', 'Please select a loss reason'))
      return
    }
    await onConfirm({
      lossReasonId,
      lossNotes: lossNotes.trim() || undefined,
    })
  }, [lossNotes, lossReasonId, onConfirm, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleConfirm()
    }
  }, [handleConfirm])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[560px]" onKeyDown={handleKeyDown}>
        <div className="overflow-hidden rounded-[12px] bg-card">
          <DialogHeader className="border-b border-border/70 px-7 py-[22px]">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold leading-none tracking-tight text-foreground">
                  {t('customers.deals.detail.lost.title', 'Mark deal as Lost?')}
                </DialogTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dealTitle}
                  {dealValue ? ` · ${dealValue}` : ''}
                  {companyName ? ` · ${companyName}` : ''}
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6 px-7 py-6">
            <Alert variant="warning" className="rounded-[6px]">
              <AlertTriangle className="size-4" />
              <AlertTitle>
                {t('customers.deals.detail.lost.warningTitle', 'This action closes the deal')}
              </AlertTitle>
              <AlertDescription>
                {t('customers.deals.detail.lost.warning', "This action sets the stage to 'Lost' and cannot be undone without 'sales.reopen' permission")}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                {t('customers.deals.detail.lost.reasonLabel', 'Loss reason')}
                <span className="ml-1 text-destructive">*</span>
              </label>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReasonListOpen((current) => !current)}
                  className="h-auto flex w-full items-center justify-between rounded-[6px] border-2 border-foreground bg-background px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-foreground">
                      {selectedLossReason?.label ?? t('customers.deals.detail.lost.reasonPlaceholder', 'Select loss reason')}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {selectedLossReason?.description ?? t('customers.deals.detail.lost.reasonHelp', 'Choose the closest reason from the dictionary.')}
                    </div>
                  </div>
                  <ChevronDown className="ml-3 size-4 shrink-0 text-muted-foreground" />
                </Button>

                {reasonListOpen ? (
                  <div className="overflow-hidden rounded-[6px] border border-border/80 bg-background">
                    {lossReasons.map((reason, index) => {
                      const isSelected = reason.id === lossReasonId
                      return (
                        <Button
                          key={reason.id}
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setLossReasonId(reason.id)
                            setReasonListOpen(false)
                            setError('')
                          }}
                          className={`h-auto flex w-full items-center justify-between rounded-none px-4 py-3 text-left ${
                            index < lossReasons.length - 1 ? 'border-b border-border/60' : ''
                          } ${isSelected ? 'bg-muted/60' : 'hover:bg-accent/50'}`}
                        >
                          <div className="min-w-0">
                            <div className="text-base font-semibold text-foreground">{reason.label}</div>
                            <div className="text-sm text-muted-foreground">
                              {reason.description ?? t('customers.deals.detail.lost.reasonFallbackDescription', 'No description available.')}
                            </div>
                          </div>
                          {isSelected ? (
                            <span className="ml-3 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                              <Check className="size-3.5" />
                            </span>
                          ) : null}
                        </Button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                {t('customers.deals.detail.lost.notesLabel', 'Loss notes (optional)')}
              </label>
              <Textarea
                value={lossNotes}
                onChange={(event) => setLossNotes(event.target.value)}
                placeholder={t('customers.deals.detail.lost.notesPlaceholder', 'Additional context about the loss...')}
                rows={4}
                className="min-h-[88px] rounded-[6px] border-border/80 px-4 py-3 shadow-none"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-7 py-4 sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('customers.deals.detail.lost.cancel', 'Cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => { void handleConfirm() }}>
              {t('customers.deals.detail.lost.confirm', 'Mark as Lost')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
