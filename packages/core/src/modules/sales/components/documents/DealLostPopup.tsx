'use client'

import * as React from 'react'
import { CloudOff } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent } from '@open-mercato/ui/primitives/dialog'

interface DealLostPopupProps {
  open: boolean
  onClose: () => void
  dealTitle: string
  dealValue: string
  lossReason: string
  lossNotes?: string
  onBackToPipeline?: () => void
  onSetReminder?: () => void
}

export function DealLostPopup({
  open,
  onClose,
  dealTitle,
  dealValue,
  lossReason,
  lossNotes,
  onBackToPipeline,
  onSetReminder,
}: DealLostPopupProps) {
  const t = useT()

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden">
        {/* Illustration area */}
        <div className="flex items-center justify-center bg-muted py-8">
          <div className="relative">
            <CloudOff className="size-20 text-muted-foreground" strokeWidth={1.5} />
            <div className="absolute top-0 right-2 text-lg text-muted-foreground">?</div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 text-center space-y-4">
          <div>
            <h2 className="text-xl font-bold">
              {t('sales.closure.popup.lostTitle', 'Not this time...')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('sales.closure.popup.lostSubtitle', 'Even the best miss sometimes')}
            </p>
          </div>

          {/* Deal summary */}
          <div className="rounded-lg border bg-card px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{dealTitle}</p>
            <p className="text-2xl font-bold text-muted-foreground mt-1">-{dealValue}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Lost · {t('sales.closure.popup.reason', 'reason')}: {lossReason}
            </p>
          </div>

          {/* What's next card */}
          {lossNotes && (
            <div className="rounded-lg border-l-2 border-l-primary bg-primary/5 px-4 py-3 text-left">
              <p className="text-xs font-semibold uppercase tracking-wide">
                {t('sales.closure.popup.whatsNext', "What's next")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{lossNotes}</p>
            </div>
          )}

          {/* CTA buttons */}
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              onClick={onBackToPipeline ?? onClose}
            >
              {t('sales.closure.popup.backToPipeline', 'Back to pipeline')}
            </Button>
            {onSetReminder && (
              <Button type="button" variant="outline" className="w-full" onClick={onSetReminder}>
                {t('sales.closure.popup.setReminder', 'Set a reminder')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
