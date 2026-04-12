"use client"

import * as React from 'react'
import { ArrowUpRight, EyeOff, Handshake } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { DealSummary } from '../formConfig'
import { formatCurrency } from './utils'

const DEFAULT_PIPELINE_STAGES = ['Lead', 'Qualification', 'Proposal', 'Negotiation']

type ActiveDealCardProps = {
  deals: DealSummary[]
  onHide?: () => void
}

export function ActiveDealCard({ deals, onHide }: ActiveDealCardProps) {
  const t = useT()

  const activeDeals = React.useMemo(
    () => deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed'),
    [deals],
  )

  const topDeal = React.useMemo(() => {
    if (activeDeals.length === 0) return null
    return [...activeDeals].sort((a, b) => {
      const va = typeof a.valueAmount === 'number' ? a.valueAmount : parseFloat(String(a.valueAmount ?? '0'))
      const vb = typeof b.valueAmount === 'number' ? b.valueAmount : parseFloat(String(b.valueAmount ?? '0'))
      return vb - va
    })[0]
  }, [activeDeals])

  if (!topDeal) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Handshake className="size-4" />
          {t('customers.companies.dashboard.activeDeal', 'Active deal')}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('customers.companies.dashboard.noDeals', 'No active deals')}
        </p>
      </div>
    )
  }

  const amount = typeof topDeal.valueAmount === 'number'
    ? topDeal.valueAmount
    : parseFloat(String(topDeal.valueAmount ?? '0'))

  const currentStage = topDeal.pipelineStage ?? null
  const stageIndex = currentStage
    ? DEFAULT_PIPELINE_STAGES.findIndex((s) => s.toLowerCase() === currentStage.toLowerCase())
    : -1

  return (
    <div className="group relative rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Handshake className="size-4" />
          {t('customers.companies.dashboard.activeDeal', 'Active deal')}
        </h3>
        <div className="flex items-center gap-1">
          {onHide && (
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              onClick={onHide}
              className="opacity-0 transition-opacity group-hover:opacity-60"
              aria-label={t('customers.companies.dashboard.hideTile', 'Hide tile')}
            >
              <EyeOff className="size-3.5" />
            </IconButton>
          )}
          <ArrowUpRight className="size-4 text-muted-foreground" />
        </div>
      </div>

      <div className="mt-3">
        <p className="font-semibold text-foreground">{topDeal.title}</p>
        {topDeal.createdAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('customers.companies.dashboard.created', 'Created')} {new Date(topDeal.createdAt).toLocaleDateString()}
          </p>
        )}

        {/* Pipeline stage progress bar */}
        {currentStage && (
          <div className="mt-3">
            <div className="flex gap-1">
              {DEFAULT_PIPELINE_STAGES.map((stage, idx) => (
                <div key={stage} className="flex-1">
                  <div
                    className={cn(
                      'h-1.5 rounded-full',
                      idx <= stageIndex ? 'bg-primary' : 'bg-muted',
                    )}
                  />
                  <p className={cn(
                    'mt-1 text-[10px]',
                    idx <= stageIndex ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}>
                    {stage}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {currentStage && !DEFAULT_PIPELINE_STAGES.some((s) => s.toLowerCase() === currentStage.toLowerCase()) && (
          <div className="mt-2">
            <Badge variant="outline" className="text-xs">{currentStage}</Badge>
          </div>
        )}

        {Number.isFinite(amount) && amount > 0 && (
          <p className="mt-2 text-lg font-bold text-foreground">
            {formatCurrency(amount, topDeal.valueCurrency)}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t('customers.companies.dashboard.potentialValue', 'potential value')}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
