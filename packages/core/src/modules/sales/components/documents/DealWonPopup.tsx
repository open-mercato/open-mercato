'use client'

import * as React from 'react'
import { Trophy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent } from '@open-mercato/ui/primitives/dialog'

interface DealWonPopupProps {
  open: boolean
  onClose: () => void
  dealTitle: string
  dealValue: string
  dealDate: string
  onViewReport?: () => void
  onBackToPipeline?: () => void
}

export function DealWonPopup({
  open,
  onClose,
  dealTitle,
  dealValue,
  dealDate,
  onViewReport,
  onBackToPipeline,
}: DealWonPopupProps) {
  const t = useT()

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden">
        {/* Illustration area */}
        <div className="flex items-center justify-center bg-primary/10 py-8">
          <div className="relative">
            <Trophy className="size-20 text-primary" strokeWidth={1.5} />
            <div className="absolute -top-2 -right-2 text-2xl">+</div>
            <div className="absolute -top-1 -left-3 text-lg">+</div>
            <div className="absolute -bottom-1 right-0 text-xl">+</div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 text-center space-y-4">
          <div>
            <h2 className="text-xl font-bold">
              {t('sales.closure.popup.wonTitle', 'Deal closed!')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('sales.closure.popup.wonSubtitle', 'You are a sales machine!')}
            </p>
          </div>

          {/* Deal summary card */}
          <div className="rounded-lg border bg-card px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{dealTitle}</p>
            <p className="text-2xl font-bold text-primary mt-1">+{dealValue}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Won · {dealDate}
            </p>
          </div>

          {/* CTA buttons */}
          <div className="space-y-2">
            {onViewReport && (
              <Button type="button" className="w-full" onClick={onViewReport}>
                {t('sales.closure.popup.viewReport', 'View sales report')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onBackToPipeline ?? onClose}
            >
              {t('sales.closure.popup.backToPipeline', 'Back to pipeline')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
