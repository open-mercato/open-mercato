"use client"

import * as React from 'react'
import { ArrowLeftRight, BadgeCheck, CreditCard, History, Timer, type LucideIcon } from 'lucide-react'
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
  slaAtRisk?: number
}

type ClaimsKpiStripProps = {
  stats: WarrantyClaimsStats | null
  isLoading: boolean
  hasError: boolean
  attentionCount?: number
  onOverdueClick: () => void
  onOpenClaimsClick: () => void
}

type KpiItemProps = {
  icon: LucideIcon
  label: string
  description: string
  value: React.ReactNode
  detail?: React.ReactNode
  onClick?: () => void
}

function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(undefined, options).format(value)
}

function KpiItem({ icon: Icon, label, description, value, detail, onClick }: KpiItemProps) {
  const content = (
    <div className="flex min-h-24 w-full items-start gap-3 px-5 py-1 text-left">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-5 text-foreground">{label}</span>
        <span className="block text-overline font-normal leading-4 text-muted-foreground">{description}</span>
        <span className="mt-2 block text-2xl font-bold leading-8 tabular-nums text-foreground">{value}</span>
        {detail ? <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  )

  if (onClick) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className="h-auto min-h-24 w-full whitespace-normal rounded-none p-0 hover:bg-muted/30"
      >
        {content}
      </Button>
    )
  }

  return (
    <div className="flex min-h-24">
      {content}
    </div>
  )
}

export function ClaimsKpiStrip({
  stats,
  isLoading,
  hasError,
  attentionCount,
  onOverdueClick,
  onOpenClaimsClick,
}: ClaimsKpiStripProps) {
  const t = useT()

  if (hasError) return null

  if (isLoading && !stats) {
    return (
      <div className="grid grid-cols-2 divide-x divide-border border-y border-border py-5 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton
            key={index}
            className="min-h-24 rounded-none"
            aria-label={t('warranty_claims.kpi.loading', 'Loading claim KPIs')}
          />
        ))}
      </div>
    )
  }

  if (!stats) return null

  const openClaims = Object.values(stats.openByStatus).reduce((sum, count) => sum + count, 0)
  const recoveredCurrencies = stats.recoveredLast30dByCurrency
  const recovered = recoveredCurrencies[0] ?? null
  const recoveredLabel = recovered
    ? formatNumber(recovered.total, { maximumFractionDigits: 2 })
    : null
  const recoveredDescription = recoveredCurrencies.length > 1
    ? t('warranty_claims.kpi.recovered.moreCurrencies', 'Last 30 days — largest of {count} currencies')
      .replace('{count}', formatNumber(recoveredCurrencies.length))
    : t('warranty_claims.kpi.last30d', 'Last 30 days')
  const slaCompliance = openClaims > 0
    ? Math.max(0, Math.round(((openClaims - stats.overdue) / openClaims) * 100))
    : 100
  const approvedCount = stats.approvalRatePct === null
    ? null
    : Math.round(stats.resolvedLast30d * stats.approvalRatePct / 100)

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border border-y border-border py-5 md:grid-cols-5 md:divide-y-0">
      <KpiItem
        icon={ArrowLeftRight}
        label={t('warranty_claims.kpi.openClaims', 'Open claims')}
        description={t('warranty_claims.kpi.openClaims.description', 'Active queue')}
        value={formatNumber(openClaims)}
        detail={t('warranty_claims.kpi.openClaims.attention', '{count} need attention', { count: formatNumber(attentionCount ?? stats.overdue) })}
        onClick={onOpenClaimsClick}
      />
      <KpiItem
        icon={Timer}
        label={t('warranty_claims.kpi.slaCompliance', 'SLA compliance')}
        description={t('warranty_claims.kpi.slaCompliance.description', 'Within target window')}
        value={`${formatNumber(slaCompliance)}%`}
        detail={t('warranty_claims.kpi.slaCompliance.overdue', '{count} overdue', { count: formatNumber(stats.overdue) })}
        onClick={onOverdueClick}
      />
      <KpiItem
        icon={History}
        label={t('warranty_claims.kpi.avgResolutionDays', 'Avg resolution')}
        description={t('warranty_claims.kpi.last30d', 'Last 30 days')}
        value={stats.avgResolutionDays === null ? t('warranty_claims.common.noValue') : t('warranty_claims.kpi.daysShort', '{count}d', { count: formatNumber(stats.avgResolutionDays, { maximumFractionDigits: 1 }) })}
        detail={t('warranty_claims.kpi.avgResolution.resolved', '{count} claims resolved', { count: formatNumber(stats.resolvedLast30d) })}
      />
      <KpiItem
        icon={BadgeCheck}
        label={t('warranty_claims.kpi.approvalRate', 'Approval rate')}
        description={t('warranty_claims.kpi.last30d', 'Last 30 days')}
        value={stats.approvalRatePct === null ? t('warranty_claims.common.noValue') : `${formatNumber(stats.approvalRatePct)}%`}
        detail={approvedCount === null ? undefined : t('warranty_claims.kpi.approvalRate.approved', '{count} claims approved', { count: formatNumber(approvedCount) })}
      />
      <KpiItem
        icon={CreditCard}
        label={t('warranty_claims.kpi.recovered', 'Recovered')}
        description={t('warranty_claims.kpi.recovered.description', 'From vendors')}
        value={recoveredLabel ?? t('warranty_claims.common.noValue')}
        detail={recovered ? `${recovered.currencyCode ?? ''} ${t('warranty_claims.kpi.last30d', 'Last 30 days')}`.trim() : recoveredDescription}
      />
    </div>
  )
}
