'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { InlineDateRangeSelect } from '@open-mercato/ui/backend/date-range/InlineDateRangeSelect'
import { resolveDateRange, type DateRangePreset } from '@open-mercato/ui/backend/date-range/dateRanges'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * MVP reports/analytics page (task 6.1, spec § Scope: quantity-based-only
 * reports — late/at-risk orders, actual vs. standard consumption, scrap by
 * reason; no valuation). Three tabs, each backed by its own
 * `api/production/analytics/*` endpoint (see route doc comments for why
 * these are a distinct prefix from the shop-floor `api/reports/*` surface).
 */

type LateOrderRow = {
  id: string
  number: number
  productId: string
  variantId: string | null
  qtyPlanned: number
  qtyCompleted: number
  remainingQty: number
  dueDate: string
  status: string
  classification: 'late' | 'at_risk'
  daysLate: number
  daysUntilDue: number
}

type LateOrdersResponse = { items: LateOrderRow[]; total: number; page: number; pageSize: number }

type ConsumptionAggregateRow = {
  componentProductId: string
  componentVariantId: string | null
  standardQty: number
  actualQty: number
  varianceQty: number
  variancePct: number | null
  orderCount: number
}

type ConsumptionLineRow = {
  orderId: string
  orderNumber: number
  componentProductId: string
  componentVariantId: string | null
  standardQty: number
  actualQty: number
  varianceQty: number
  variancePct: number | null
}

type ConsumptionResponse = {
  productAggregates: ConsumptionAggregateRow[]
  lines: ConsumptionLineRow[]
  total: number
  page: number
  pageSize: number
}

type ScrapReasonRow = {
  scrapReasonEntryId: string
  label: string
  qtyScrap: number
  reportCount: number
}

type ScrapReasonsResponse = { items: ScrapReasonRow[] }

function formatPct(value: number | null): string {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function LateOrdersTab() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<LateOrderRow[]>([])
  const [atRiskDays, setAtRiskDays] = React.useState(7)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100', atRiskDays: String(atRiskDays) })
        const fallback: LateOrdersResponse = { items: [], total: 0, page: 1, pageSize: 100 }
        const call = await apiCall<LateOrdersResponse>(`/api/production/analytics/late-orders?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          if (!cancelled) flash(t('production.analytics.error.late_orders_failed', 'Failed to load late/at-risk orders.'), 'error')
          return
        }
        if (!cancelled) setRows(call.result?.items ?? [])
      } catch {
        if (!cancelled) flash(t('production.analytics.error.late_orders_failed', 'Failed to load late/at-risk orders.'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [atRiskDays, scopeVersion, t])

  const columns = React.useMemo<ColumnDef<LateOrderRow>[]>(
    () => [
      {
        id: 'number',
        accessorKey: 'number',
        header: t('production.analytics.late_orders.field.number', 'Order #'),
      },
      {
        id: 'classification',
        accessorKey: 'classification',
        header: t('production.analytics.late_orders.field.classification', 'Status'),
        cell: ({ row }) => (
          <Badge variant={row.original.classification === 'late' ? 'error' : 'warning'}>
            {t(`production.analytics.late_orders.classification.${row.original.classification}`, row.original.classification)}
          </Badge>
        ),
      },
      {
        id: 'dueDate',
        accessorKey: 'dueDate',
        header: t('production.analytics.late_orders.field.due_date', 'Due date'),
        cell: ({ row }) => new Date(row.original.dueDate).toLocaleDateString(),
      },
      {
        id: 'qtyPlanned',
        accessorKey: 'qtyPlanned',
        header: t('production.analytics.late_orders.field.qty_planned', 'Planned qty'),
      },
      {
        id: 'qtyCompleted',
        accessorKey: 'qtyCompleted',
        header: t('production.analytics.late_orders.field.qty_completed', 'Completed qty'),
      },
      {
        id: 'remainingQty',
        accessorKey: 'remainingQty',
        header: t('production.analytics.late_orders.field.remaining_qty', 'Remaining qty'),
      },
      {
        id: 'daysLate',
        accessorKey: 'daysLate',
        header: t('production.analytics.late_orders.field.days_late', 'Days late'),
        cell: ({ row }) => (row.original.classification === 'late' ? row.original.daysLate : '—'),
      },
      {
        id: 'daysUntilDue',
        accessorKey: 'daysUntilDue',
        header: t('production.analytics.late_orders.field.days_until_due', 'Days until due'),
        cell: ({ row }) => (row.original.classification === 'at_risk' ? row.original.daysUntilDue : '—'),
      },
    ],
    [t],
  )

  return (
    <DataTable<LateOrderRow>
      title={t('production.analytics.tabs.late_orders', 'Late & At-Risk Orders')}
      columns={columns}
      data={rows}
      isLoading={isLoading}
      actions={
        <div className="flex items-center gap-2">
          <Label htmlFor="at-risk-days">{t('production.analytics.late_orders.filters.at_risk_days', 'At-risk window (days)')}</Label>
          <Input
            id="at-risk-days"
            type="number"
            min={0}
            max={365}
            value={atRiskDays}
            onChange={(event) => setAtRiskDays(Math.max(0, Number(event.target.value) || 0))}
            className="w-20"
          />
        </div>
      }
    />
  )
}

function ConsumptionTab() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [preset, setPreset] = React.useState<DateRangePreset>('last_30_days')
  const [aggregates, setAggregates] = React.useState<ConsumptionAggregateRow[]>([])
  const [lines, setLines] = React.useState<ConsumptionLineRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const { start, end } = resolveDateRange(preset)
        const params = new URLSearchParams({
          page: '1',
          pageSize: '100',
          dateFrom: start.toISOString(),
          dateTo: end.toISOString(),
        })
        const fallback: ConsumptionResponse = { productAggregates: [], lines: [], total: 0, page: 1, pageSize: 100 }
        const call = await apiCall<ConsumptionResponse>(`/api/production/analytics/consumption?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          if (!cancelled) flash(t('production.analytics.error.consumption_failed', 'Failed to load consumption report.'), 'error')
          return
        }
        if (!cancelled) {
          setAggregates(call.result?.productAggregates ?? [])
          setLines(call.result?.lines ?? [])
        }
      } catch {
        if (!cancelled) flash(t('production.analytics.error.consumption_failed', 'Failed to load consumption report.'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [preset, scopeVersion, t])

  const aggregateColumns = React.useMemo<ColumnDef<ConsumptionAggregateRow>[]>(
    () => [
      { id: 'componentProductId', accessorKey: 'componentProductId', header: t('production.analytics.consumption.field.product', 'Component product') },
      { id: 'standardQty', accessorKey: 'standardQty', header: t('production.analytics.consumption.field.standard_qty', 'Standard qty') },
      { id: 'actualQty', accessorKey: 'actualQty', header: t('production.analytics.consumption.field.actual_qty', 'Actual qty') },
      { id: 'varianceQty', accessorKey: 'varianceQty', header: t('production.analytics.consumption.field.variance_qty', 'Variance qty') },
      {
        id: 'variancePct',
        accessorKey: 'variancePct',
        header: t('production.analytics.consumption.field.variance_pct', 'Variance %'),
        cell: ({ row }) => formatPct(row.original.variancePct),
      },
      { id: 'orderCount', accessorKey: 'orderCount', header: t('production.analytics.consumption.field.order_count', 'Orders') },
    ],
    [t],
  )

  const lineColumns = React.useMemo<ColumnDef<ConsumptionLineRow>[]>(
    () => [
      { id: 'orderNumber', accessorKey: 'orderNumber', header: t('production.analytics.late_orders.field.number', 'Order #') },
      { id: 'componentProductId', accessorKey: 'componentProductId', header: t('production.analytics.consumption.field.product', 'Component product') },
      { id: 'standardQty', accessorKey: 'standardQty', header: t('production.analytics.consumption.field.standard_qty', 'Standard qty') },
      { id: 'actualQty', accessorKey: 'actualQty', header: t('production.analytics.consumption.field.actual_qty', 'Actual qty') },
      { id: 'varianceQty', accessorKey: 'varianceQty', header: t('production.analytics.consumption.field.variance_qty', 'Variance qty') },
      {
        id: 'variancePct',
        accessorKey: 'variancePct',
        header: t('production.analytics.consumption.field.variance_pct', 'Variance %'),
        cell: ({ row }) => formatPct(row.original.variancePct),
      },
    ],
    [t],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Label>{t('production.analytics.date_range.label', 'Date range')}</Label>
        <InlineDateRangeSelect value={preset} onChange={setPreset} />
      </div>
      <DataTable<ConsumptionAggregateRow>
        title={t('production.analytics.consumption.aggregate_title', 'By product')}
        columns={aggregateColumns}
        data={aggregates}
        isLoading={isLoading}
      />
      <DataTable<ConsumptionLineRow>
        title={t('production.analytics.consumption.lines_title', 'By order')}
        columns={lineColumns}
        data={lines}
        isLoading={isLoading}
      />
    </div>
  )
}

function ScrapReasonsTab() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [preset, setPreset] = React.useState<DateRangePreset>('last_30_days')
  const [rows, setRows] = React.useState<ScrapReasonRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const { start, end } = resolveDateRange(preset)
        const params = new URLSearchParams({ dateFrom: start.toISOString(), dateTo: end.toISOString() })
        const fallback: ScrapReasonsResponse = { items: [] }
        const call = await apiCall<ScrapReasonsResponse>(`/api/production/analytics/scrap-reasons?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          if (!cancelled) flash(t('production.analytics.error.scrap_failed', 'Failed to load scrap-by-reason report.'), 'error')
          return
        }
        if (!cancelled) setRows(call.result?.items ?? [])
      } catch {
        if (!cancelled) flash(t('production.analytics.error.scrap_failed', 'Failed to load scrap-by-reason report.'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [preset, scopeVersion, t])

  const columns = React.useMemo<ColumnDef<ScrapReasonRow>[]>(
    () => [
      { id: 'label', accessorKey: 'label', header: t('production.analytics.scrap.field.reason', 'Reason') },
      { id: 'qtyScrap', accessorKey: 'qtyScrap', header: t('production.analytics.scrap.field.qty_scrap', 'Scrap qty') },
      { id: 'reportCount', accessorKey: 'reportCount', header: t('production.analytics.scrap.field.report_count', 'Reports') },
    ],
    [t],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Label>{t('production.analytics.date_range.label', 'Date range')}</Label>
        <InlineDateRangeSelect value={preset} onChange={setPreset} />
      </div>
      <DataTable<ScrapReasonRow>
        title={t('production.analytics.tabs.scrap', 'Scrap by Reason')}
        columns={columns}
        data={rows}
        isLoading={isLoading}
      />
    </div>
  )
}

export default function ProductionAnalyticsPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <Tabs defaultValue="late_orders" className="w-full">
          <TabsList>
            <TabsTrigger value="late_orders">{t('production.analytics.tabs.late_orders', 'Late & At-Risk Orders')}</TabsTrigger>
            <TabsTrigger value="consumption">{t('production.analytics.tabs.consumption', 'Consumption')}</TabsTrigger>
            <TabsTrigger value="scrap">{t('production.analytics.tabs.scrap', 'Scrap by Reason')}</TabsTrigger>
          </TabsList>
          <TabsContent value="late_orders">
            <LateOrdersTab />
          </TabsContent>
          <TabsContent value="consumption">
            <ConsumptionTab />
          </TabsContent>
          <TabsContent value="scrap">
            <ScrapReasonsTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </Page>
  )
}
