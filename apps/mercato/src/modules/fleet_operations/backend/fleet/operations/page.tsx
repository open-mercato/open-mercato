"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import {
  buildOperationsEntityConfigs,
  isOperationsEntityKey,
  type OperationsEntityKey,
} from '../../../lib/entityConfig'

type Row = Record<string, unknown> & { id: string; updatedAt?: string | null }

type Summary = {
  openWorkOrders: number
  overdueSchedules: number
  expiringPolicies: number
  openViolations: number
  fuelCost30d: string
  maintenanceCost30d: string
}

const TAB_ORDER: OperationsEntityKey[] = [
  'work-orders',
  'maintenance-schedules',
  'fuel-logs',
  'insurance-policies',
  'traffic-violations',
]

function statusVariant(value: unknown): 'neutral' | 'success' | 'warning' | 'error' | 'info' {
  if (value === 'completed' || value === 'paid' || value === 'active') return 'success'
  if (value === 'cancelled' || value === 'failed' || value === 'expired') return 'error'
  if (value === 'in_progress' || value === 'appealed') return 'warning'
  if (value === 'open') return 'info'
  return 'neutral'
}

export default function FleetOperationsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const configs = React.useMemo(() => buildOperationsEntityConfigs(t), [t])
  const requestedTab = searchParams.get('tab') ?? 'work-orders'
  const activeKey: OperationsEntityKey = isOperationsEntityKey(requestedTab) ? requestedTab : 'work-orders'
  const config = configs[activeKey]

  const [rows, setRows] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `fleet-operations-list:${activeKey}`,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    setPage(1)
    setSearch('')
  }, [activeKey])

  React.useEffect(() => {
    let cancelled = false
    apiCall<{ summary?: Summary }>('/api/fleet_operations/dashboard-summary')
      .then((response) => {
        if (!cancelled && response.ok && response.result?.summary) setSummary(response.result.summary)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) params.set('search', search.trim())
    apiCall<{ items?: Row[]; total?: number }>(`${config.apiPath}?${params.toString()}`)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          const items = Array.isArray(response.result.items) ? response.result.items : []
          setRows(items)
          setTotal(typeof response.result.total === 'number' ? response.result.total : items.length)
          return
        }
        flash(t('fleet_operations.list.loadError', 'Failed to load records.'), 'error')
      })
      .catch(() => {
        if (!cancelled) flash(t('fleet_operations.list.loadError', 'Failed to load records.'), 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [config.apiPath, page, pageSize, search, reloadToken, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => apiCallOrThrow(`${config.apiPath}?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
        ),
        mutationPayload: { operation: `${config.key}.delete`, id: row.id, updatedAt: row.updatedAt },
        context: {
          formId: `fleet-operations-list:${config.key}`,
          resourceKind: `fleet_operations:${config.key}`,
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(t('fleet_operations.list.deleted', 'Record deleted.'), 'success')
      setReloadToken((token) => token + 1)
    } catch {
      flash(t('fleet_operations.list.deleteError', 'Failed to delete the record.'), 'error')
    }
  }, [config.apiPath, config.key, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => (
    config.columns.map((column, index) => ({
      id: column.id,
      header: column.label,
      accessorFn: (row) => row[column.field] ?? '',
      cell: ({ row }) => {
        const value = row.original[column.field]
        if (index === 0) {
          return (
            <Link
              href={`/backend/fleet/operations/${config.key}/${row.original.id}`}
              className="font-medium text-primary hover:underline"
            >
              {formatCell(value)}
            </Link>
          )
        }
        if (column.id === 'status') {
          return <StatusBadge variant={statusVariant(value)} dot>{formatCell(value)}</StatusBadge>
        }
        if (column.id === 'isActive') {
          return value === false
            ? <StatusBadge variant="neutral" dot>{t('fleet_operations.status.inactive', 'Inactive')}</StatusBadge>
            : <StatusBadge variant="success" dot>{t('fleet_operations.status.active', 'Active')}</StatusBadge>
        }
        if (column.id.endsWith('At') || column.id.endsWith('Date')) {
          return formatDateTime(typeof value === 'string' ? value : null) ?? '—'
        }
        return formatCell(value)
      },
    }))
  ), [config, t])

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{t('fleet_operations.nav.group', 'Fleet operations')}</h1>
          <Button asChild className="ms-auto">
            <Link href={`/backend/fleet/operations/${config.key}/create`}>
              {t('fleet_operations.list.new', 'New record')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/backend/fleet/vehicles">{t('fleet_operations.list.vehicles', 'Vehicles')}</Link>
          </Button>
        </div>

        {summary ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <SummaryCard label={t('fleet_operations.summary.openWorkOrders', 'Open work orders')} value={summary.openWorkOrders} />
            <SummaryCard label={t('fleet_operations.summary.overdueSchedules', 'Overdue schedules')} value={summary.overdueSchedules} />
            <SummaryCard label={t('fleet_operations.summary.expiringPolicies', 'Expiring policies')} value={summary.expiringPolicies} />
            <SummaryCard label={t('fleet_operations.summary.openViolations', 'Open violations')} value={summary.openViolations} />
            <SummaryCard label={t('fleet_operations.summary.fuel30d', 'Fuel (30d)')} value={summary.fuelCost30d} />
            <SummaryCard label={t('fleet_operations.summary.maintenance30d', 'Maintenance (30d)')} value={summary.maintenanceCost30d} />
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2">
          {TAB_ORDER.map((key) => (
            <Button
              key={key}
              asChild
              variant={key === activeKey ? 'default' : 'outline'}
              size="sm"
            >
              <Link href={`/backend/fleet/operations?tab=${key}`}>{configs[key].title}</Link>
            </Button>
          ))}
        </div>

        <DataTable<Row>
          title={config.title}
          titleHeadingLevel={2}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/fleet/operations/${config.key}/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'open',
                  label: t('fleet_operations.list.open', 'Open'),
                  onSelect: () => router.push(`/backend/fleet/operations/${config.key}/${row.id}`),
                },
                {
                  id: 'delete',
                  label: t('fleet_operations.list.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => { void handleDelete(row) },
                },
              ]}
            />
          )}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('fleet_operations.list.search', 'Search…')}
          pagination={{
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            onPageChange: setPage,
            pageSizeOptions: [10, 25, 50, 100],
            onPageSizeChange: (next) => {
              setPageSize(next)
              setPage(1)
            },
          }}
          isLoading={loading}
          refreshButton={{
            label: t('fleet_operations.list.refresh', 'Refresh'),
            onRefresh: () => setReloadToken((token) => token + 1),
          }}
        />
      </PageBody>
    </Page>
  )
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}
