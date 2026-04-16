"use client"

import * as React from 'react'
import { EyeOff } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard, type KpiTrend } from '@open-mercato/ui/backend/charts/KpiCard'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { CompanyOverview, DealSummary, InteractionSummary } from '../formConfig'
import { formatCurrency } from './utils'

const STORAGE_KEY = 'om:company-detail-kpi-hidden'

function sumActiveDeals(deals: DealSummary[]): number {
  return deals
    .filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
    .reduce((sum, d) => {
      const amount = typeof d.valueAmount === 'number' ? d.valueAmount : parseFloat(String(d.valueAmount ?? '0'))
      return sum + (Number.isFinite(amount) ? amount : 0)
    }, 0)
}

function getActiveDeals(deals: DealSummary[]): DealSummary[] {
  return deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
}

function computeActivityTrend(interactions: InteractionSummary[]): KpiTrend | undefined {
  const now = Date.now()
  const weekMs = 7 * 86_400_000
  const thisWeek = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    return d && now - new Date(d).getTime() < weekMs
  }).length
  const lastWeek = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    if (!d) return false
    const diff = now - new Date(d).getTime()
    return diff >= weekMs && diff < weekMs * 2
  }).length
  if (lastWeek === 0 && thisWeek === 0) return undefined
  if (lastWeek === 0) return { value: 100, direction: 'up' }
  const pct = ((thisWeek - lastWeek) / lastWeek) * 100
  if (Math.abs(pct) < 0.5) return { value: 0, direction: 'unchanged' }
  return { value: Math.abs(pct), direction: pct > 0 ? 'up' : 'down' }
}

function computeDealTrend(deals: DealSummary[]): KpiTrend | undefined {
  const active = deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
  if (active.length === 0) return undefined
  const now = Date.now()
  const monthMs = 30 * 86_400_000
  const recentDeals = active.filter((d) => d.createdAt && now - new Date(d.createdAt).getTime() < monthMs).length
  if (recentDeals > 0) return { value: recentDeals * 10, direction: 'up' }
  return { value: 0, direction: 'unchanged' }
}

type CompanyKpiBarProps = {
  data: CompanyOverview
}

export function CompanyKpiBar({ data }: CompanyKpiBarProps) {
  const t = useT()

  const activeDeals = React.useMemo(() => getActiveDeals(data.deals), [data.deals])
  const activeDealsValue = React.useMemo(
    () => data.kpis?.activeDealsValue ?? sumActiveDeals(data.deals),
    [data.deals, data.kpis?.activeDealsValue],
  )
  const dealCurrency = data.kpis?.dealCurrency ?? activeDeals[0]?.valueCurrency ?? data.deals[0]?.valueCurrency ?? 'PLN'
  const activityTrend = React.useMemo(
    () => data.kpis?.activityTrend ?? computeActivityTrend(data.interactions),
    [data.interactions, data.kpis?.activityTrend],
  )
  const dealTrend = React.useMemo(() => computeDealTrend(data.deals), [data.deals])

  const ltvValue = React.useMemo(() => {
    if (data.kpis?.ltvValue !== undefined) return data.kpis.ltvValue
    const wonDeals = data.deals.filter((d) => d.status === 'won')
    if (wonDeals.length === 0) return null
    return wonDeals.reduce((sum, d) => {
      const amt = typeof d.valueAmount === 'number' ? d.valueAmount : parseFloat(String(d.valueAmount ?? '0'))
      return sum + (Number.isFinite(amt) ? amt : 0)
    }, 0)
  }, [data.deals, data.kpis?.ltvValue])

  const clientTenureYears = React.useMemo(() => {
    if (data.kpis?.clientTenureYears !== undefined) return data.kpis.clientTenureYears
    const allDates = data.interactions
      .map((i) => i.occurredAt ?? i.scheduledAt ?? i.createdAt)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
    if (allDates.length === 0) return null
    const earliest = Math.min(...allDates)
    return Math.floor((Date.now() - earliest) / (365.25 * 86_400_000))
  }, [data.interactions, data.kpis?.clientTenureYears])

  const [hiddenTiles, setHiddenTiles] = React.useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

  const toggleTile = React.useCallback((tileId: string) => {
    setHiddenTiles((prev) => {
      const next = new Set(prev)
      if (next.has(tileId)) next.delete(tileId)
      else next.add(tileId)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])

  const showAllTiles = React.useCallback(() => {
    setHiddenTiles(new Set())
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }, [])

  const kpiTiles = React.useMemo(() => [
    {
      id: 'activeDeals',
      title: t('customers.companies.dashboard.kpi.activeDeals', 'ACTIVE DEALS'),
      value: activeDealsValue,
      trend: dealTrend,
      formatValue: (v: number) => formatCurrency(v, dealCurrency),
      comparisonLabel: `${data.kpis?.activeDealsCount ?? activeDeals.length} ${(data.kpis?.activeDealsCount ?? activeDeals.length) === 1 ? 'pipeline' : 'pipelines'}`,
    },
    {
      id: 'activities',
      title: t('customers.companies.dashboard.kpi.activities', 'ACTIVITIES'),
      value: data.kpis?.activityCount ?? data.interactions.length,
      trend: activityTrend,
      comparisonLabel: t('customers.companies.dashboard.kpi.last12months', 'last 12 months'),
    },
    {
      id: 'ltv',
      title: t('customers.companies.dashboard.kpi.ltv', 'CUSTOMER VALUE (LTV)'),
      value: ltvValue,
      formatValue: ltvValue !== null ? (v: number) => formatCurrency(v, dealCurrency) : undefined,
      comparisonLabel: ltvValue !== null
        ? t('customers.companies.dashboard.kpi.wonDeals', 'won deals total')
        : t('customers.companies.dashboard.kpi.noWonDeals', 'No won deals'),
    },
    {
      id: 'clientSince',
      title: t('customers.companies.dashboard.kpi.clientSince', 'CLIENT SINCE'),
      value: clientTenureYears,
      formatValue: clientTenureYears !== null
        ? (v: number) => v < 1
          ? `< 1 ${t('customers.companies.dashboard.kpi.year', 'year')}`
          : `${v} ${v === 1 ? t('customers.companies.dashboard.kpi.year', 'year') : t('customers.companies.dashboard.kpi.years', 'years')}`
        : undefined,
      comparisonLabel: clientTenureYears !== null
        ? `${data.kpis?.completedDealsCount ?? data.deals.filter((d) => d.status === 'won').length} ${t('customers.companies.dashboard.kpi.completedDeals', 'completed deals')}`
        : t('customers.companies.dashboard.kpi.noInteractions', 'No interactions yet'),
    },
  ], [t, activeDealsValue, dealTrend, dealCurrency, activeDeals.length, activityTrend, ltvValue, clientTenureYears, data.deals, data.interactions.length, data.kpis])

  const visibleTiles = kpiTiles.filter((tile) => !hiddenTiles.has(tile.id))

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleTiles.map((tile) => (
          <div key={tile.id} className="group relative">
            <KpiCard
              title={tile.title}
              value={tile.value}
              trend={tile.trend}
              formatValue={tile.formatValue}
              comparisonLabel={tile.comparisonLabel}
            />
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => toggleTile(tile.id)}
              className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-60"
              aria-label={t('customers.companies.dashboard.hideTile', 'Hide tile')}
            >
              <EyeOff className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
      {hiddenTiles.size > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('customers.companies.dashboard.hiddenTiles', '{{count}} tiles hidden', { count: hiddenTiles.size })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-1.5 py-0.5 text-xs hover:bg-transparent"
            onClick={showAllTiles}
          >
            {t('customers.companies.dashboard.showAll', 'Show all')}
          </Button>
        </div>
      )}
    </div>
  )
}
