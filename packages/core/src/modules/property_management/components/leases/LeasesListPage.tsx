"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { AlertTriangle, Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import {
  LEASES_HREF,
  LEASES_MANAGE_FEATURE,
  formatDate,
  formatMoney,
  statusLabel,
  statusVariant,
  type LeaseSummary,
} from './leaseModel'

const PAGE_SIZE = 50
const ALL = 'all'

const STATUS_CHIPS: Record<string, string> = {
  all: '',
  active: 'active',
  proposed: 'proposed',
  activating: 'pending_order',
  ended: 'ended',
  closed: 'withdrawn,expired,declined',
}

type ListPayload = { items?: LeaseSummary[]; total?: number; totalPages?: number; error?: string }
type BuildingOption = { id: string; name: string }

export function LeasesListPage({ schedulerAvailable }: { schedulerAvailable: boolean }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chrome } = useBackendChrome()
  const canManage = hasFeature(chrome?.grantedFeatures, LEASES_MANAGE_FEATURE)
  const [rows, setRows] = React.useState<LeaseSummary[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [chip, setChip] = React.useState('all')
  const [buildingId, setBuildingId] = React.useState(ALL)
  const [buildings, setBuildings] = React.useState<BuildingOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ items?: BuildingOption[] }>('/api/property_management/buildings?pageSize=100&sortField=name&sortDir=asc', undefined, { fallback: {} })
      .then((call) => {
        if (!cancelled && call.ok) setBuildings(Array.isArray(call.result?.items) ? call.result.items : [])
      })
    return () => {
      cancelled = true
    }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (search.trim()) params.set('search', search.trim())
    if (STATUS_CHIPS[chip]) params.set('status', STATUS_CHIPS[chip])
    if (buildingId !== ALL) params.set('buildingId', buildingId)
    void apiCall<ListPayload>(`/api/property_management/leases?${params.toString()}`, undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          flash(call.result?.error ?? t('property_management.leases.list.loadError', 'Could not load leases.'), 'error')
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRows(items)
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, search, chip, buildingId, reloadToken, scopeVersion, t])

  const columns = React.useMemo<ColumnDef<LeaseSummary>[]>(() => [
    {
      accessorKey: 'reference',
      header: t('property_management.leases.list.column.reference', 'Lease'),
      meta: { alwaysVisible: true, maxWidth: '140px' },
      cell: ({ row }) => (
        <Link href={`${LEASES_HREF}/${row.original.id}`} className="font-mono font-medium hover:underline">{row.original.reference}</Link>
      ),
    },
    {
      accessorKey: 'unitName',
      header: t('property_management.leases.list.column.unit', 'Unit'),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span>{row.original.unitName ?? '—'}</span>
          <span className="text-xs text-muted-foreground">{[row.original.buildingName, row.original.floorName].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { accessorKey: 'companyName', header: t('property_management.leases.list.column.tenant', 'Tenant'), meta: { truncate: true, maxWidth: '220px' } },
    { accessorKey: 'productName', header: t('property_management.leases.list.column.product', 'Product'), meta: { truncate: true, maxWidth: '200px' } },
    {
      accessorKey: 'endsOn',
      header: t('property_management.leases.list.column.term', 'Term'),
      cell: ({ row }) => `${formatDate(row.original.startsOn, locale)} — ${formatDate(row.original.endsOn, locale)}`,
    },
    {
      accessorKey: 'monthlyRate',
      header: t('property_management.leases.list.column.monthly', 'Monthly'),
      cell: ({ row }) => formatMoney(row.original.monthlyRate, row.original.currencyCode, locale),
    },
    {
      accessorKey: 'status',
      header: t('property_management.leases.list.column.status', 'Status'),
      cell: ({ row }) => <LeaseStatusCell lease={row.original} />,
    },
    {
      accessorKey: 'salesOrderNumber',
      header: t('property_management.leases.list.column.order', 'Sales order'),
      cell: ({ row }) => row.original.salesOrderNumber ?? '—',
    },
  ], [locale, t])

  return (
    <Page>
      <PageBody className="space-y-4">
        {schedulerAvailable ? null : (
          <Alert status="information">
            <AlertTitle>{t('property_management.leases.list.noScheduler.title', 'Automatic lease sweeps are off')}</AlertTitle>
            <AlertDescription>
              {t(
                'property_management.leases.list.noScheduler.body',
                'The scheduler is not installed, so leases are not ended at term and proposals do not expire automatically. Run them with: mercato property_management sweep:run',
              )}
            </AlertDescription>
          </Alert>
        )}
        <DataTable<LeaseSummary>
          title={t('property_management.leases.list.title', 'Leases')}
          titleHeadingLevel={1}
          actions={canManage ? (
            <Button asChild>
              <Link href={`${LEASES_HREF}/create`}>
                <Plus className="size-4" aria-hidden />
                {t('property_management.leases.list.new', 'New lease')}
              </Link>
            </Button>
          ) : null}
          toolbar={(
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl value={chip} onValueChange={(value) => { setChip(value); setPage(1) }} aria-label={t('property_management.leases.list.statusFilter', 'Filter by status')}>
                <SegmentedControlItem value="all">{t('property_management.leases.list.chip.all', 'All')}</SegmentedControlItem>
                <SegmentedControlItem value="active">{t('property_management.leases.list.chip.active', 'Active')}</SegmentedControlItem>
                <SegmentedControlItem value="proposed">{t('property_management.leases.list.chip.proposed', 'Proposed')}</SegmentedControlItem>
                <SegmentedControlItem value="activating">{t('property_management.leases.list.chip.activating', 'Activating')}</SegmentedControlItem>
                <SegmentedControlItem value="ended">{t('property_management.leases.list.chip.ended', 'Ended')}</SegmentedControlItem>
                <SegmentedControlItem value="closed">{t('property_management.leases.list.chip.closed', 'Withdrawn or expired')}</SegmentedControlItem>
                <SegmentedControlItem value="unavailable" disabled title={t('property_management.leases.list.chip.unavailableHint', 'Arrives with unit availability')}>
                  {t('property_management.leases.list.chip.unavailable', 'Unit unavailable')}
                </SegmentedControlItem>
              </SegmentedControl>
              <Select value={buildingId} onValueChange={(value) => { setBuildingId(value); setPage(1) }}>
                <SelectTrigger className="w-56" aria-label={t('property_management.leases.list.buildingFilter', 'Filter by building')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('property_management.leases.list.allBuildings', 'All buildings')}</SelectItem>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id}>{building.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          refreshButton={{ label: t('property_management.common.refresh', 'Refresh'), onRefresh: () => setReloadToken((value) => value + 1), isRefreshing: loading }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('property_management.leases.list.search', 'Search by lease reference')}
          isLoading={loading}
          onRowClick={(row) => router.push(`${LEASES_HREF}/${row.id}`)}
          emptyState={(
            <ListEmptyState
              title={t('property_management.leases.list.empty.title', 'No leases yet')}
              description={t('property_management.leases.list.empty.description', 'Create a lease, or send one to a tenant as a proposal.')}
              createHref={canManage ? `${LEASES_HREF}/create` : undefined}
              createLabel={t('property_management.leases.list.new', 'New lease')}
            />
          )}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}

function LeaseStatusCell({ lease }: { lease: LeaseSummary }) {
  const t = useT()
  const locale = useLocale()
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge variant={statusVariant(lease.status)} dot>{statusLabel(t, lease.status)}</StatusBadge>
      {lease.openProposal && lease.status !== 'proposed' ? (
        <StatusBadge variant="info">{t('property_management.leases.list.extensionProposed', 'Extension proposed')}</StatusBadge>
      ) : null}
      {lease.openProposal ? (
        <span className="text-xs text-muted-foreground">
          {t('property_management.leases.list.respondBy', 'Respond by {date}', { date: formatDate(lease.openProposal.respondBy, locale) })}
        </span>
      ) : null}
      {lease.pendingChange ? (
        <StatusBadge variant="warning">{t('property_management.leases.billing.pendingShort', 'Billing update pending')}</StatusBadge>
      ) : null}
      {lease.billingAttention ? (
        <AlertTriangle className="size-4 text-status-warning-icon" aria-label={t('property_management.leases.billing.attention', 'Billing needs attention')} />
      ) : null}
    </span>
  )
}

export default LeasesListPage
