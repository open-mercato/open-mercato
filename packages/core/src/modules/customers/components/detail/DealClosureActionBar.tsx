"use client"

import * as React from 'react'
import { ArrowRight, Check, Info, Trophy, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

type DealClosureActionBarProps = {
  closureOutcome: string | null
  onWon: () => void
  onLost: () => void
  disabled?: boolean
  embedded?: boolean
}

export function DealClosureActionBar({
  closureOutcome,
  onWon,
  onLost,
  disabled = false,
  embedded = false,
}: DealClosureActionBarProps) {
  const t = useT()

  if (closureOutcome) return null

  return (
    <div className={embedded ? '' : 'rounded-[20px] border bg-card px-5 py-4'}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Info className="size-4 text-muted-foreground" />
          <span>{t('customers.deals.detail.closure.prompt', 'Close deal — choose outcome')}</span>
          <span className="text-border">·</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onWon}
            disabled={disabled}
            className="h-11 rounded-[10px] bg-status-success-icon px-5 text-sm font-semibold text-white hover:bg-status-success-icon/90"
          >
            <Trophy className="size-4" />
            {t('customers.deals.detail.closure.won', 'Won')}
            <Check className="size-4 stroke-[2.5]" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onLost}
            disabled={disabled}
            className="h-11 rounded-[10px] border-status-error-border px-5 text-sm font-semibold text-status-error-text hover:bg-status-error-bg"
          >
            <X className="size-4 stroke-[2.5]" />
            {t('customers.deals.detail.closure.lost', 'Lost')}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
