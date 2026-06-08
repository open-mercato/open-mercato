"use client"

import * as React from 'react'
import { CheckCircle } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { KpiCard, DeltaBadge, Sparkline } from '@open-mercato/ui/backend/charts'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { PipelineStageBar } from './kpi/PipelineStageBar'

type DeltaDirection = 'up' | 'down' | 'unchanged'

type SummaryDelta = {
  value: number
  direction: DeltaDirection
}

type DealsSummaryResponse = {
  baseCurrencyCode: string | null
  convertedAll: boolean
  missingRateCurrencies: string[]
  pipelineValue: {
    value: number
    delta: SummaryDelta
    stages: { stage: string | null; count: number; value: number }[]
  }
  activeDeals: {
    value: number
    delta: SummaryDelta
    ownersCount: number
    needAttention: number
    owners: { id: string; count: number }[]
    ownersOverflow: number
  }
  wonThisQuarter: {
    value: number
    delta: SummaryDelta
    dealsClosed: number
    avgDeal: number
  }
  winRate: {
    value: number
    deltaPp: number
    direction: DeltaDirection
    previousValue: number
    series: { period: string; rate: number }[]
  }
}

export type DealsKpiStripProps = {
  ownerNames: Record<string, string>
  stageDictionary: DictionaryMap
  pipelineCount: number
  className?: string
}

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatCompact(value: number): string {
  return compactNumberFormatter.format(value)
}

function buildCurrencySuffix(code: string | null, convertedAll: boolean): string {
  if (!code) return convertedAll ? '' : '≈'
  return convertedAll ? code : `≈ ${code}`
}

const KPI_TITLE_CLASS = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground'

function DealKpiCard(props: React.ComponentProps<typeof KpiCard>) {
  return <KpiCard titleClassName={KPI_TITLE_CLASS} {...props} />
}

export function DealsKpiStrip({ ownerNames, stageDictionary, pipelineCount, className }: DealsKpiStripProps) {
  const t = useT()
  const [data, setData] = React.useState<DealsSummaryResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiCall<DealsSummaryResponse>('/api/customers/deals/summary')
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result) {
          setError(t('customers.deals.list.kpi.error'))
          setData(null)
          return
        }
        setData(call.result)
      })
      .catch(() => {
        if (cancelled) return
        setError(t('customers.deals.list.kpi.error'))
        setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const gridClassName = cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', className)

  if (loading) {
    return (
      <div className={gridClassName}>
        <DealKpiCard loading title={t('customers.deals.list.kpi.pipelineValue')} value={null} />
        <DealKpiCard loading title={t('customers.deals.list.kpi.activeDeals')} value={null} />
        <DealKpiCard loading title={t('customers.deals.list.kpi.wonThisQuarter')} value={null} />
        <DealKpiCard loading title={t('customers.deals.list.kpi.winRate')} value={null} />
      </div>
    )
  }

  if (error || !data) {
    const errorMessage = error ?? t('customers.deals.list.kpi.error')
    return (
      <div className={gridClassName}>
        <DealKpiCard title={t('customers.deals.list.kpi.pipelineValue')} value={null} error={errorMessage} />
        <DealKpiCard title={t('customers.deals.list.kpi.activeDeals')} value={null} error={errorMessage} />
        <DealKpiCard title={t('customers.deals.list.kpi.wonThisQuarter')} value={null} error={errorMessage} />
        <DealKpiCard title={t('customers.deals.list.kpi.winRate')} value={null} error={errorMessage} />
      </div>
    )
  }

  const currencySuffix = buildCurrencySuffix(data.baseCurrencyCode, data.convertedAll)
  const unassignedLabel = t('customers.deals.list.kpi.unassignedStage')

  return (
    <div className={gridClassName}>
      <DealKpiCard
        title={t('customers.deals.list.kpi.pipelineValue')}
        value={data.pipelineValue.value}
        formatValue={formatCompact}
        suffix={currencySuffix}
        headerAction={
          <DeltaBadge direction={data.pipelineValue.delta.direction} value={data.pipelineValue.delta.value} />
        }
        footer={
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('customers.deals.list.kpi.activeAcrossPipelines', {
                count: data.activeDeals.value,
                pipelines: pipelineCount,
              })}
            </p>
            <PipelineStageBar
              stages={data.pipelineValue.stages}
              stageDictionary={stageDictionary}
              unassignedLabel={unassignedLabel}
            />
          </div>
        }
      />

      <DealKpiCard
        title={t('customers.deals.list.kpi.activeDeals')}
        value={data.activeDeals.value}
        formatValue={formatCompact}
        headerAction={
          <DeltaBadge direction={data.activeDeals.delta.direction} value={data.activeDeals.delta.value} />
        }
        footer={
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('customers.deals.list.kpi.ownersNeedAttention', {
                owners: data.activeDeals.ownersCount,
                attention: data.activeDeals.needAttention,
              })}
            </p>
            {data.activeDeals.owners.length > 0 ? (
              <AvatarStack max={4} size="sm">
                {data.activeDeals.owners.map((owner) => (
                  <Avatar key={owner.id} label={ownerNames[owner.id] ?? owner.id} size="sm" />
                ))}
              </AvatarStack>
            ) : null}
          </div>
        }
      />

      <DealKpiCard
        title={t('customers.deals.list.kpi.wonThisQuarter')}
        value={data.wonThisQuarter.value}
        formatValue={formatCompact}
        suffix={currencySuffix}
        headerAction={
          <DeltaBadge direction={data.wonThisQuarter.delta.direction} value={data.wonThisQuarter.delta.value} />
        }
        footer={
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-status-success-text" aria-hidden />
              <span>
                {t('customers.deals.list.kpi.dealsClosed', { count: data.wonThisQuarter.dealsClosed })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('customers.deals.list.kpi.avgDeal', {
                value: `${formatCompact(data.wonThisQuarter.avgDeal)}${currencySuffix ? ` ${currencySuffix}` : ''}`,
              })}
            </p>
          </div>
        }
      />

      <DealKpiCard
        title={t('customers.deals.list.kpi.winRate')}
        value={data.winRate.value}
        suffix="%"
        headerAction={
          <DeltaBadge direction={data.winRate.direction} value={Math.abs(data.winRate.deltaPp)} unit="pp" />
        }
        footer={
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('customers.deals.list.kpi.fromLastQuarter', { value: data.winRate.previousValue })}
            </p>
            <div className="text-primary">
              <Sparkline
                values={data.winRate.series.map((point) => point.rate)}
                ariaLabel={t('customers.deals.list.kpi.winRate')}
              />
            </div>
          </div>
        }
      />
    </div>
  )
}

export default DealsKpiStrip
