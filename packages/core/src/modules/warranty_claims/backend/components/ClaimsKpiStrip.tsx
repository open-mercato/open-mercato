"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

export type WarrantyClaimsRecoveredCurrency = {
  currencyCode: string | null
  total: number
}

export type WarrantyClaimsStats = {
  openByStatus: Record<string, number>
  overdue: number
  assignedToMe: number
  resolvedLast30d: number
  avgResolutionDays: number | null
  approvalRatePct: number | null
  recoveredLast30dByCurrency: WarrantyClaimsRecoveredCurrency[]
  slaAtRiskThresholdPct?: number
}

type ClaimsKpiStripProps = {
  stats: WarrantyClaimsStats | null
  isLoading: boolean
  hasError: boolean
  onOverdueClick: () => void
  onAssignedToMeClick: () => void
  onOpenClaimsClick: () => void
}

type KpiCardProps = {
  label: string
  value: React.ReactNode
  description: string
  tone?: 'default' | 'error'
  onClick?: () => void
}

function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(undefined, options).format(value)
}

function KpiCard({ label, value, description, tone = 'default', onClick }: KpiCardProps) {
  const content = (
    <>
      <span className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums',
          tone === 'error' ? 'text-status-error-text' : 'text-foreground',
        )}
      >
        {value}
      </span>
      <span className="mt-1 text-xs text-muted-foreground">{description}</span>
    </>
  )

  if (onClick) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className="h-auto min-h-24 w-full flex-col items-start justify-start whitespace-normal rounded-lg border border-border bg-card p-4 text-left shadow-sm"
      >
        {content}
      </Button>
    )
  }

  return (
    <div className="flex min-h-24 flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
      {content}
    </div>
  )
}

export function ClaimsKpiStrip({
  stats,
  isLoading,
  hasError,
  onOverdueClick,
  onAssignedToMeClick,
  onOpenClaimsClick,
}: ClaimsKpiStripProps) {
  const t = useT()

  if (hasError) return null

  if (isLoading && !stats) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton
            key={index}
            className="min-h-24 rounded-lg border border-border"
            aria-label={t('warranty_claims.kpi.loading', 'Loading claim KPIs')}
          />
        ))}
      </div>
    )
  }

  if (!stats) return null

  const openClaims = Object.values(stats.openByStatus).reduce((sum, count) => sum + count, 0)
  const recovered = stats.recoveredLast30dByCurrency[0] ?? null
  const recoveredLabel = recovered
    ? `${formatNumber(recovered.total, { maximumFractionDigits: 2 })}${recovered.currencyCode ? ` ${recovered.currencyCode}` : ''}`
    : null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <KpiCard
        label={t('warranty_claims.kpi.openClaims', 'Open claims')}
        value={formatNumber(openClaims)}
        description={t('warranty_claims.kpi.openClaims.description', 'Active queue')}
        onClick={onOpenClaimsClick}
      />
      <KpiCard
        label={t('warranty_claims.kpi.overdue', 'Overdue')}
        value={formatNumber(stats.overdue)}
        description={t('warranty_claims.kpi.overdue.description', 'Needs attention')}
        tone="error"
        onClick={onOverdueClick}
      />
      <KpiCard
        label={t('warranty_claims.kpi.assignedToMe', 'Assigned to me')}
        value={formatNumber(stats.assignedToMe)}
        description={t('warranty_claims.kpi.assignedToMe.description', 'Open claims')}
        onClick={onAssignedToMeClick}
      />
      <KpiCard
        label={t('warranty_claims.kpi.avgResolutionDays', 'Avg resolution days')}
        value={stats.avgResolutionDays === null ? t('warranty_claims.common.noValue') : formatNumber(stats.avgResolutionDays, { maximumFractionDigits: 1 })}
        description={t('warranty_claims.kpi.last30d', 'Last 30 days')}
      />
      <KpiCard
        label={t('warranty_claims.kpi.approvalRate', 'Approval rate')}
        value={stats.approvalRatePct === null ? t('warranty_claims.common.noValue') : `${formatNumber(stats.approvalRatePct)}%`}
        description={t('warranty_claims.kpi.last30d', 'Last 30 days')}
      />
      {recoveredLabel ? (
        <KpiCard
          label={t('warranty_claims.kpi.recovered', 'Recovered')}
          value={recoveredLabel}
          description={t('warranty_claims.kpi.last30d', 'Last 30 days')}
        />
      ) : null}
    </div>
  )
}
