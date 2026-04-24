"use client"

import * as React from 'react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { ChartColumnIncreasing, Clock3, Medal, Trophy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'

type DealStatsPayload = {
  dealValue: number | null
  dealCurrency: string | null
  closureOutcome: 'won' | 'lost'
  closedAt: string
  pipelineName: string | null
  dealsClosedThisPeriod: number
  salesCycleDays: number | null
  dealRankInQuarter: number | null
  lossReason: string | null
}

type DealWonPopupProps = {
  open: boolean
  onClose: () => void
  dealTitle: string
  stats: DealStatsPayload | null
  onViewDashboard?: () => void
  onBackToPipeline?: () => void
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (!currency) return value.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency}`
  }
}

function formatClosedDate(value: string, t: ReturnType<typeof useT>): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('customers.deals.detail.won.closed', 'Closed')
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSalesCycle(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value >= 30) {
    const months = Math.max(1, Math.round(value / 30))
    return `${months} mo`
  }
  return `${value}d`
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border bg-background px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

export function DealWonPopup({
  open,
  onClose,
  dealTitle,
  stats,
  onViewDashboard,
  onBackToPipeline,
}: DealWonPopupProps) {
  const t = useT()

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[420px]">
        <VisuallyHidden>
          <DialogTitle>{t('customers.deals.detail.won.title', 'Closed successfully')}</DialogTitle>
        </VisuallyHidden>
        <div className="overflow-hidden rounded-2xl bg-card">
          <div className="px-6 pb-5 pt-6">
            {/* TODO(ds-review): decorative gradient — consider defining a named gradient token if reused */}
            <div className="flex h-[200px] items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(141,150,244,0.5),rgba(198,203,254,0.95))] text-foreground">
              <Trophy className="size-24" strokeWidth={1.5} />
            </div>
          </div>

          <div className="space-y-5 px-7 pb-7 text-center">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold leading-tight text-foreground">
                {t('customers.deals.detail.won.title', 'Closed successfully')}
              </h2>
              <p className="text-sm font-medium text-muted-foreground">
                {t('customers.deals.detail.won.subtitle', 'You are a sales machine!')}
              </p>
            </div>

            <div className="rounded-xl border bg-muted/20 px-4 py-4">
              <p className="text-overline font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {dealTitle}
              </p>
              <p className="mt-2 text-2xl font-bold text-primary">
                {stats ? formatCurrency(stats.dealValue, stats.dealCurrency) : '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('customers.deals.detail.won.closed', 'Won')} · {stats ? formatClosedDate(stats.closedAt, t) : '—'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatCard
                icon={<ChartColumnIncreasing className="size-4" />}
                label={t('customers.deals.detail.won.dealsThisWeek', 'Deals this week')}
                value={stats ? String(stats.dealsClosedThisPeriod) : '—'}
              />
              <StatCard
                icon={<Clock3 className="size-4" />}
                label={t('customers.deals.detail.won.salesCycle', 'Sales cycle')}
                value={formatSalesCycle(stats?.salesCycleDays ?? null)}
              />
              <StatCard
                icon={<Medal className="size-4" />}
                label={t('customers.deals.detail.won.rank', 'Quarter rank')}
                value={stats?.dealRankInQuarter !== null && stats?.dealRankInQuarter !== undefined ? `#${stats.dealRankInQuarter}` : '—'}
              />
            </div>

            <div className="rounded-2xl border bg-muted/30 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t('customers.deals.detail.won.pipeline', 'Pipeline')}
              </div>
              <div className="mt-2 text-sm text-foreground">
                {stats?.pipelineName ?? t('customers.deals.detail.won.pipelineFallback', 'Current pipeline')}
              </div>
            </div>

            <div className="space-y-2">
              {onViewDashboard ? (
                <Button type="button" className="w-full" onClick={onViewDashboard}>
                  {t('customers.deals.detail.won.primaryAction', 'View sales report')}
                </Button>
              ) : null}
              <Button type="button" variant={onViewDashboard ? 'outline' : 'default'} className="w-full" onClick={onBackToPipeline ?? onClose}>
                {t('customers.deals.detail.won.secondaryAction', 'Back to pipeline')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
