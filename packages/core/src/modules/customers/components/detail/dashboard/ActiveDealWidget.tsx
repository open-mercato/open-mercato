"use client"

import * as React from 'react'
import { Users, ArrowUpRight } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { DealSummary } from '../../formConfig'
import { formatCurrency } from '../utils'

export function ActiveDealWidget({ deals, t }: { deals: DealSummary[]; t: TranslateFn }) {
  const topDeal = deals.sort((a, b) => {
    const va = typeof a.valueAmount === 'number' ? a.valueAmount : parseFloat(String(a.valueAmount ?? '0'))
    const vb = typeof b.valueAmount === 'number' ? b.valueAmount : parseFloat(String(b.valueAmount ?? '0'))
    return vb - va
  })[0]

  if (!topDeal) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="size-4" />
          {t('customers.companies.dashboard.activeDeal', 'Active deal')}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noDeals', 'No active deals')}</p>
      </div>
    )
  }

  const amount = typeof topDeal.valueAmount === 'number' ? topDeal.valueAmount : parseFloat(String(topDeal.valueAmount ?? '0'))

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="size-4" />
          {t('customers.companies.dashboard.activeDeal', 'Active deal')}
        </h3>
        <ArrowUpRight className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-3">
        <p className="font-semibold text-foreground">{topDeal.title}</p>
        {topDeal.createdAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('customers.companies.dashboard.created', 'Created')} {new Date(topDeal.createdAt).toLocaleDateString()}
          </p>
        )}
        {topDeal.pipelineStage && (
          <div className="mt-2">
            <Badge variant="outline" className="text-xs">{topDeal.pipelineStage}</Badge>
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
