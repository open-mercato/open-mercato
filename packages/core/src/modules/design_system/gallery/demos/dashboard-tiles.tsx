"use client"

import * as React from 'react'
import { Banknote, Globe, MoreHorizontal, ShoppingCart, UsersRound, Wallet } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  BarChart,
  BreakdownList,
  KpiCard,
  MetricDelta,
  SignalBadge,
  StackedFlowChart,
  TileHeader,
} from '@open-mercato/ui/backend/charts'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

const REVENUE_TREND = [41, 44, 43, 47, 46, 52, 55, 54, 59, 63, 61, 68]
const ORDERS_TREND = [310, 322, 318, 305, 331, 329, 340, 336, 344, 349, 351, 349]
const AOV_TREND = [92, 91, 93, 90, 89, 88, 90, 87, 86, 88, 85, 84]
const CUSTOMERS_TREND = [18, 22, 19, 24, 21, 26, 23, 25, 29, 27, 31, 58]

const formatEuro = (value: number) => `€${value.toLocaleString('en-US')}`

function WidgetFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={`flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-xs ${className ?? ''}`}>{children}</section>
}

export function DashboardKpiTilesExample() {
  const t = useT()
  const comparison = t('design_system.gallery.samples.tiles.vsPrevious')
  const axisLabels = { start: t('design_system.gallery.samples.tiles.rangeStart'), end: t('design_system.gallery.samples.tiles.rangeEnd') }
  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <WidgetFrame>
        <KpiCard
          appearance="minimal"
          title={t('design_system.gallery.samples.tiles.revenue')}
          icon={<Banknote className="size-5" />}
          value={68400}
          formatValue={formatEuro}
          trend={REVENUE_TREND}
          trendAriaLabel={t('design_system.gallery.samples.tiles.trendAria')}
          signal={{ variant: 'success', kind: 'shift-up', label: t('design_system.gallery.samples.tiles.aboveRange') }}
          delta={{ value: 11.5, direction: 'up' }}
          comparisonLabel={comparison}
          axisLabels={axisLabels}
        />
      </WidgetFrame>
      <WidgetFrame>
        <KpiCard
          appearance="minimal"
          title={t('design_system.gallery.samples.tiles.orders')}
          icon={<ShoppingCart className="size-5" />}
          value={349}
          trend={ORDERS_TREND}
          trendAriaLabel={t('design_system.gallery.samples.tiles.trendAria')}
          signal={{ variant: 'neutral', label: t('design_system.gallery.samples.tiles.withinRange') }}
          delta={{ value: 4.2, direction: 'up' }}
          comparisonLabel={comparison}
          axisLabels={axisLabels}
        />
      </WidgetFrame>
      <WidgetFrame>
        <KpiCard
          appearance="minimal"
          title={t('design_system.gallery.samples.tiles.aov')}
          icon={<Wallet className="size-5" />}
          value={84}
          formatValue={formatEuro}
          trend={AOV_TREND}
          trendAriaLabel={t('design_system.gallery.samples.tiles.trendAria')}
          signal={{ variant: 'error', kind: 'shift-down', label: t('design_system.gallery.samples.tiles.belowRange') }}
          delta={{ value: 6.1, direction: 'down' }}
          comparisonLabel={comparison}
          axisLabels={axisLabels}
        />
      </WidgetFrame>
      <WidgetFrame>
        <KpiCard
          appearance="minimal"
          title={t('design_system.gallery.samples.tiles.newCustomers')}
          icon={<UsersRound className="size-5" />}
          value={58}
          trend={CUSTOMERS_TREND}
          trendAriaLabel={t('design_system.gallery.samples.tiles.trendAria')}
          signal={{ variant: 'warning', kind: 'spike-up', label: t('design_system.gallery.samples.tiles.oneOffSpike') }}
          delta={{ value: 87, direction: 'up' }}
          comparisonLabel={comparison}
          axisLabels={axisLabels}
        />
      </WidgetFrame>
    </div>
  )
}

export function DashboardKpiMinimalExample() {
  const t = useT()
  return (
    <WidgetFrame className="w-full max-w-sm">
      <KpiCard
        appearance="minimal"
        title={t('design_system.gallery.samples.tiles.revenue')}
        icon={<Banknote className="size-5" />}
        value={68400}
        formatValue={formatEuro}
        trend={REVENUE_TREND}
        trendAriaLabel={t('design_system.gallery.samples.tiles.trendAria')}
        signal={{ variant: 'success', kind: 'shift-up', label: t('design_system.gallery.samples.tiles.aboveRange') }}
        delta={{ value: 11.5, direction: 'up' }}
        comparisonLabel={t('design_system.gallery.samples.tiles.vsPrevious')}
        axisLabels={{ start: t('design_system.gallery.samples.tiles.rangeStart'), end: t('design_system.gallery.samples.tiles.rangeEnd') }}
      />
    </WidgetFrame>
  )
}

export function MetricDeltaExample() {
  const t = useT()
  const label = t('design_system.gallery.samples.tiles.vsPrevious')
  return (
    <div className="flex flex-col gap-3">
      <MetricDelta deltaPct={0.124} label={label} />
      <MetricDelta deltaPct={-0.047} label={label} />
      <MetricDelta deltaPct={0} label={label} />
      <MetricDelta deltaPct={null} label={t('design_system.gallery.samples.tiles.noComparison')} />
    </div>
  )
}

export function SignalBadgeExample() {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SignalBadge variant="success" kind="shift-up" label={t('design_system.gallery.samples.tiles.aboveRange')} />
      <SignalBadge variant="error" kind="shift-down" label={t('design_system.gallery.samples.tiles.belowRange')} />
      <SignalBadge variant="warning" kind="spike-up" label={t('design_system.gallery.samples.tiles.oneOffSpike')} />
      <SignalBadge variant="neutral" label={t('design_system.gallery.samples.tiles.withinRange')} />
    </div>
  )
}

export function TileHeaderExample() {
  const t = useT()
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <TileHeader title={t('design_system.gallery.samples.tiles.revenue')} icon={<Banknote />} />
      <TileHeader
        title={t('design_system.gallery.samples.tiles.salesByRegion')}
        icon={<Globe />}
        action={<IconButton type="button" variant="ghost" size="sm" aria-label={t('design_system.gallery.samples.tiles.moreActions')}><MoreHorizontal className="size-4" /></IconButton>}
      />
      <TileHeader title={t('design_system.gallery.samples.tiles.orders')} />
    </div>
  )
}

function useRegionRows() {
  const t = useT()
  return [
    { key: 'north', label: t('design_system.gallery.samples.tiles.regionNorth'), value: 28400 },
    { key: 'central', label: t('design_system.gallery.samples.tiles.regionCentral'), value: 17900 },
    { key: 'south', label: t('design_system.gallery.samples.tiles.regionSouth'), value: 11200 },
    { key: 'west', label: t('design_system.gallery.samples.tiles.regionWest'), value: 7300 },
    { key: 'east', label: t('design_system.gallery.samples.tiles.regionEast'), value: 3600 },
  ]
}

export function BreakdownListExample() {
  const rows = useRegionRows()
  return <BreakdownList className="w-full max-w-sm" rows={rows} formatValue={formatEuro} />
}

export function SalesByRegionTileExample() {
  const t = useT()
  const rows = useRegionRows()
  return (
    <WidgetFrame className="w-full max-w-sm gap-4">
      <TileHeader title={t('design_system.gallery.samples.tiles.salesByRegion')} icon={<Globe />} as="h2" />
      <BreakdownList rows={rows} formatValue={formatEuro} />
    </WidgetFrame>
  )
}

function useStageSeries() {
  const t = useT()
  const stages = {
    fresh: t('design_system.gallery.samples.tiles.stageNew'),
    qualified: t('design_system.gallery.samples.tiles.stageQualified'),
    proposal: t('design_system.gallery.samples.tiles.stageProposal'),
    won: t('design_system.gallery.samples.tiles.stageWon'),
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun'].map((month) => t(`design_system.gallery.samples.content.${month}`))
  const values = [
    [18, 12, 7, 4],
    [22, 14, 9, 6],
    [20, 17, 10, 7],
    [26, 18, 13, 9],
    [24, 21, 14, 11],
    [29, 23, 17, 14],
  ]
  return {
    series: Object.values(stages),
    data: months.map((label, index) => ({
      label,
      values: {
        [stages.fresh]: values[index][0],
        [stages.qualified]: values[index][1],
        [stages.proposal]: values[index][2],
        [stages.won]: values[index][3],
      },
    })),
  }
}

export function StackedFlowChartExample() {
  const { series, data } = useStageSeries()
  return <StackedFlowChart className="w-full" data={data} series={series} height={260} />
}

export function BarChartHighlightExample() {
  const t = useT()
  const revenue = t('design_system.gallery.samples.tiles.revenue')
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun'].map((month) => t(`design_system.gallery.samples.content.${month}`))
  const values = [48200, 51900, 47300, 58800, 62100, 67300]
  return (
    <BarChart
      className="w-full"
      title={revenue}
      data={months.map((month, index) => ({ month, [revenue]: values[index] }))}
      index="month"
      categories={[revenue]}
      valueFormatter={formatEuro}
      highlight="max"
      showLegend={false}
    />
  )
}
