"use client"

import * as React from 'react'
import { CheckCircle } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { KpiCard, DeltaBadge, Sparkline } from '@open-mercato/ui/backend/charts'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
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
  /** Bumped by the host when the active org scope changes — forces a KPI refetch so the cards never show another org's data. */
  scopeVersion?: number
  /** Bumped by the host on manual refresh / after mutations — forces a KPI refetch so totals stay in sync with the table. */
  reloadToken?: number
  onNeedsAttentionClick?: () => void
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

function KpiDeltaBadge({
  direction,
  value,
  unit,
  title,
}: {
  direction: DeltaDirection
  value: number
  unit?: string
  title: string
}) {
  if (direction === 'unchanged' && value === 0) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-text"
        title={title}
      >
        --
      </span>
    )
  }
  return <DeltaBadge direction={direction} value={value} unit={unit} title={title} />
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Guard the summary payload before rendering: a non-conforming response (an unrelated
// endpoint mock, an error body, or a future contract drift) must surface the error card,
// never crash the whole deals page by dereferencing missing sections/arrays.
function isDealsSummaryResponse(value: unknown): value is DealsSummaryResponse {
  if (!isObject(value)) return false
  const { pipelineValue, activeDeals, wonThisQuarter, winRate } = value
  return (
    isObject(pipelineValue) && Array.isArray(pipelineValue.stages) &&
    isObject(activeDeals) && Array.isArray(activeDeals.owners) &&
    isObject(wonThisQuarter) &&
    isObject(winRate) && Array.isArray(winRate.series)
  )
}

export function DealsKpiStrip({
  ownerNames,
  stageDictionary,
  pipelineCount,
  className,
  scopeVersion,
  reloadToken,
  onNeedsAttentionClick,
}: DealsKpiStripProps) {
  const t = useT()
  const locale = useLocale()
  const pluralCat = React.useCallback((count: number): string => {
    try {
      return new Intl.PluralRules(locale).select(count)
    } catch {
      return count === 1 ? 'one' : 'other'
    }
  }, [locale])
  const pf = React.useCallback((base: string, count: number): string => {
    const cat = pluralCat(count)
    const key = `${base}.${cat}`
    const out = t(key, { count })
    return out === key ? t(`${base}.other`, { count }) : out
  }, [t, pluralCat])
  const [data, setData] = React.useState<DealsSummaryResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  const previousScopeVersionRef = React.useRef(scopeVersion)

  const retry = React.useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const scopeChanged = previousScopeVersionRef.current !== scopeVersion
    previousScopeVersionRef.current = scopeVersion
    if (scopeChanged) setData(null)
    setLoading(true)
    setError(null)
    apiCall<DealsSummaryResponse>('/api/customers/deals/summary')
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !isDealsSummaryResponse(call.result)) {
          setError(t('customers.deals.list.kpi.error'))
          return
        }
        setData(call.result)
      })
      .catch(() => {
        if (cancelled) return
        setError(t('customers.deals.list.kpi.error'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t, scopeVersion, reloadToken, retryToken])

  const wrapperClassName = cn('space-y-2', className)
  const gridClassName = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'

  if (loading && !data) {
    return (
      <div className={wrapperClassName}>
        <div className={gridClassName}>
          <DealKpiCard loading title={t('customers.deals.list.kpi.pipelineValue')} value={null} />
          <DealKpiCard loading title={t('customers.deals.list.kpi.activeDeals')} value={null} />
          <DealKpiCard loading title={t('customers.deals.list.kpi.wonThisQuarter')} value={null} />
          <DealKpiCard loading title={t('customers.deals.list.kpi.winRate')} value={null} />
        </div>
      </div>
    )
  }

  if (!data) {
    const errorMessage = error ?? t('customers.deals.list.kpi.error')
    return (
      <div className={wrapperClassName}>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button type="button" variant="destructive-outline" size="sm" onClick={retry}>
            {t('customers.deals.list.kpi.retry')}
          </Button>
        </div>
      </div>
    )
  }

  const currencySuffix = buildCurrencySuffix(data.baseCurrencyCode, data.convertedAll)
  const unassignedLabel = t('customers.deals.list.kpi.unassignedStage')
  const deltaTooltip = t('customers.deals.list.kpi.deltaTooltip')
  const deltaUnavailableTooltip = t('customers.deals.list.kpi.deltaUnavailable')
  const scopeLabel = t('customers.deals.list.kpi.scopeAllPipelinesThisQuarter')
  const unknownOwner = t('customers.deals.list.unknownOwner')
  const currencyHint = !data.convertedAll
    ? data.baseCurrencyCode
      ? t('customers.deals.list.kpi.currencyApproxMissing', {
          currencies: data.missingRateCurrencies.length ? data.missingRateCurrencies.join(', ') : currencySuffix,
        })
      : t('customers.deals.list.kpi.currencyApproxNoBase')
    : null
  const attentionLabel = pf('customers.deals.list.kpi.frag.needAttention', data.activeDeals.needAttention)

  return (
    <div className={wrapperClassName}>
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button type="button" variant="destructive-outline" size="2xs" onClick={retry}>
            {t('customers.deals.list.kpi.retry')}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Spinner className="h-3 w-3" />
          <span>{t('customers.deals.list.kpi.updating')}</span>
        </div>
      ) : null}
      <div className={gridClassName}>
        <DealKpiCard
          title={t('customers.deals.list.kpi.pipelineValue')}
          value={data.pipelineValue.value}
          formatValue={formatCompact}
          suffix={currencySuffix}
          headerAction={
            <KpiDeltaBadge
              direction={data.pipelineValue.delta.direction}
              value={data.pipelineValue.delta.value}
              title={data.pipelineValue.delta.direction === 'unchanged' && data.pipelineValue.delta.value === 0 ? deltaUnavailableTooltip : deltaTooltip}
            />
          }
          footer={
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{scopeLabel}</p>
              <p className="text-xs text-muted-foreground">
                {t('customers.deals.list.kpi.activeAcrossPipelines', {
                  deals: pf('customers.deals.list.kpi.frag.activeDeals', data.activeDeals.value),
                  pipelines: pf('customers.deals.list.kpi.frag.pipelines', pipelineCount),
                })}
              </p>
              {currencyHint ? <p className="text-xs text-muted-foreground">{currencyHint}</p> : null}
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
            <KpiDeltaBadge
              direction={data.activeDeals.delta.direction}
              value={data.activeDeals.delta.value}
              title={data.activeDeals.delta.direction === 'unchanged' && data.activeDeals.delta.value === 0 ? deltaUnavailableTooltip : deltaTooltip}
            />
          }
          footer={
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{scopeLabel}</p>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                <span>{pf('customers.deals.list.kpi.frag.owners', data.activeDeals.ownersCount)}</span>
                <span aria-hidden="true">·</span>
                {onNeedsAttentionClick && data.activeDeals.needAttention > 0 ? (
                  <Button
                    type="button"
                    variant="link"
                    size="2xs"
                    className="h-auto p-0 text-xs"
                    onClick={onNeedsAttentionClick}
                  >
                    {attentionLabel}
                  </Button>
                ) : (
                  <span>{attentionLabel}</span>
                )}
              </div>
              {data.activeDeals.owners.length > 0 ? (
                <AvatarStack max={4} size="sm" overflowCount={data.activeDeals.ownersOverflow}>
                  {data.activeDeals.owners.map((owner) => {
                    const ownerLabel = ownerNames[owner.id]?.trim() || unknownOwner
                    return <Avatar key={owner.id} label={ownerLabel} size="sm" />
                  })}
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
            <KpiDeltaBadge
              direction={data.wonThisQuarter.delta.direction}
              value={data.wonThisQuarter.delta.value}
              title={data.wonThisQuarter.delta.direction === 'unchanged' && data.wonThisQuarter.delta.value === 0 ? deltaUnavailableTooltip : deltaTooltip}
            />
          }
          footer={
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{scopeLabel}</p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-status-success-text" aria-hidden />
                <span>
                  {pf('customers.deals.list.kpi.frag.dealsClosed', data.wonThisQuarter.dealsClosed)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('customers.deals.list.kpi.avgDeal', {
                  value: `${formatCompact(data.wonThisQuarter.avgDeal)}${currencySuffix ? ` ${currencySuffix}` : ''}`,
                })}
              </p>
              {currencyHint ? <p className="text-xs text-muted-foreground">{currencyHint}</p> : null}
            </div>
          }
        />

        <DealKpiCard
          title={t('customers.deals.list.kpi.winRate')}
          value={data.winRate.value}
          suffix="%"
          headerAction={
            <KpiDeltaBadge
              direction={data.winRate.direction}
              value={Math.abs(data.winRate.deltaPp)}
              unit="pp"
              title={data.winRate.previousValue === 0 ? deltaUnavailableTooltip : deltaTooltip}
            />
          }
          footer={
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{scopeLabel}</p>
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
    </div>
  )
}

export default DealsKpiStrip
