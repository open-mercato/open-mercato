"use client"

import * as React from 'react'
import { ChevronDown, Trophy, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'

type DealClosureActionBarProps = {
  closureOutcome: string | null
  onWon: () => void
  onLost: () => void
  disabled?: boolean
  /**
   * @deprecated The bar is a "Close deal" popover trigger and draws no card of its own, so the flag has no
   * effect. Kept so existing callers keep compiling for at least one minor release after 0.10.0.
   */
  embedded?: boolean
}

export function DealClosureActionBar({
  closureOutcome,
  onWon,
  onLost,
  disabled = false,
}: DealClosureActionBarProps) {
  const t = useT()

  if (closureOutcome) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {t('customers.deals.detail.closure.closeDeal', 'Close deal')}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <div className="flex flex-col">
          <PopoverClose asChild>
            <Button type="button" size="sm" variant="ghost" onClick={onWon} className="w-full justify-start">
              <Trophy className="size-4 text-status-success-icon" />
              {t('customers.deals.detail.closure.won', 'Won')}
            </Button>
          </PopoverClose>
          <PopoverClose asChild>
            <Button type="button" size="sm" variant="ghost" onClick={onLost} className="w-full justify-start">
              <X className="size-4 text-status-error-icon" />
              {t('customers.deals.detail.closure.lost', 'Lost')}
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}
