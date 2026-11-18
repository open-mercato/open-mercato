"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { AlertTriangle, Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { hasFeature } from '@open-mercato/shared/security/features'
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
import { lastDayOf } from '../availability/availabilityModel'
import { PROPERTY_MANAGE_FEATURE } from '../manageAccess'
import { CrmHiddenNote } from '../CrmHiddenNote'
import { leaseToday, useLeaseSettings } from './useLeaseSettings'
import { useLeaseBuildingOptions } from './useLeaseBuildingOptions'
import { ALL_BUILDINGS, LEASES_PAGE_SIZE, UNAVAILABLE_CHIP, useLeasesList } from './useLeasesList'

const BUILDINGS_FAILED = 'buildings-failed'

export function LeasesListPage({ schedulerAvailable }: { schedulerAvailable: boolean }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const { payload: chrome } = useBackendChrome()
  const canManage = hasFeature(chrome?.grantedFeatures, LEASES_MANAGE_FEATURE)
  const canReadSettings = canManage || hasFeature(chrome?.grantedFeatures, PROPERTY_MANAGE_FEATURE)
  const { settings } = useLeaseSettings({ enabled: canReadSettings })
  const serverToday = settings?.today ?? null
  const { buildings: buildingOptions, loadError: buildingsError, retry: retryBuildings } = useLeaseBuildingOptions()
  const buildings = buildingOptions ?? []
  const {
    rows, total, totalPages, loading, loadError, crmAccess, reload, page, setPage, search, setSearch, chip, setChip, buildingId, setBuildingId,
  } = useLeasesList()

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
      meta: { truncate: false },
      cell: ({ row }) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>{row.original.unitName ?? '—'}</span>
          <span className="text-xs text-muted-foreground">{[row.original.buildingName, row.original.floorName].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    {
      accessorKey: 'companyName',
      header: t('property_management.leases.list.column.tenant', 'Tenant'),
      meta: { truncate: true, maxWidth: '220px' },
      cell: ({ row }) => crmAccess.companies ? (row.original.companyName ?? '—') : <CrmHiddenNote testId="pm-leases-crm-hidden" />,
    },
    { accessorKey: 'productName', header: t('property_management.leases.list.column.product', 'Product'), meta: { truncate: true, maxWidth: '200px' } },
    {
      accessorKey: 'endsOn',
      header: t('property_management.leases.list.column.term', 'Term'),
      meta: { truncate: false },
      cell: ({ row }) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>{formatDate(row.original.startsOn, locale)} —</span>
          <span>{formatDate(row.original.endsOn, locale)}</span>
        </span>
      ),
    },
    {
      accessorKey: 'monthlyRate',
      header: t('property_management.leases.list.column.monthly', 'Monthly'),
      cell: ({ row }) => formatMoney(row.original.monthlyRate, row.original.currencyCode, locale),
    },
    {
      accessorKey: 'status',
      header: t('property_management.leases.list.column.status', 'Status'),
      meta: { truncate: false },
      cell: ({ row }) => <LeaseStatusCell lease={row.original} today={serverToday} />,
    },
    {
      accessorKey: 'salesOrderNumber',
      header: t('property_management.leases.list.column.order', 'Sales order'),
      meta: { truncate: false },
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.salesOrderNumber ?? '—'}</span>,
    },
  ], [crmAccess.companies, locale, serverToday, t])

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
            <FilterBar
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('property_management.leases.list.search', 'Search by lease reference')}
              trailingItems={(
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedControl value={chip} onValueChange={setChip} aria-label={t('property_management.leases.list.statusFilter', 'Filter by status')}>
                    <SegmentedControlItem value="all">{t('property_management.leases.list.chip.all', 'All')}</SegmentedControlItem>
                    <SegmentedControlItem value="active">{t('property_management.leases.list.chip.active', 'Active')}</SegmentedControlItem>
                    <SegmentedControlItem value="proposed">{t('property_management.leases.list.chip.proposed', 'Proposed')}</SegmentedControlItem>
                    <SegmentedControlItem value="activating">{t('property_management.leases.list.chip.activating', 'Activating')}</SegmentedControlItem>
                    <SegmentedControlItem value="ended">{t('property_management.leases.list.chip.ended', 'Ended')}</SegmentedControlItem>
                    <SegmentedControlItem value="closed">{t('property_management.leases.list.chip.closed', 'Withdrawn or expired')}</SegmentedControlItem>
                    <SegmentedControlItem value={UNAVAILABLE_CHIP}>
                      {t('property_management.leases.list.chip.unavailable', 'Unit unavailable')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                  <Select
                    value={buildingId}
                    onValueChange={setBuildingId}
                    onOpenChange={(open) => { if (open && buildingsError) retryBuildings() }}
                  >
                    <SelectTrigger className="w-56" aria-label={t('property_management.leases.list.buildingFilter', 'Filter by building')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_BUILDINGS}>{t('property_management.leases.list.allBuildings', 'All buildings')}</SelectItem>
                      {buildingsError ? <SelectItem value={BUILDINGS_FAILED} disabled>{buildingsError}</SelectItem> : null}
                      {buildings.map((building) => (
                        <SelectItem key={building.value} value={building.value}>{building.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />
          )}
          refreshButton={{ label: t('property_management.common.refresh', 'Refresh'), onRefresh: reload, isRefreshing: loading }}
          columns={columns}
          data={rows}
          isLoading={loading}
          onRowClick={(row) => router.push(`${LEASES_HREF}/${row.id}`)}
          emptyState={loadError ? (
            <ErrorMessage
              label={loadError}
              action={<Button type="button" variant="outline" onClick={reload}>{t('property_management.common.retry', 'Try again')}</Button>}
            />
          ) : (
            <ListEmptyState
              title={t('property_management.leases.list.empty.title', 'No leases yet')}
              description={t('property_management.leases.list.empty.description', 'Create a lease, or send one to a tenant as a proposal.')}
              createHref={canManage ? `${LEASES_HREF}/create` : undefined}
              createLabel={t('property_management.leases.list.new', 'New lease')}
            />
          )}
          pagination={{ page, pageSize: LEASES_PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}

function LeaseStatusCell({ lease, today }: { lease: LeaseSummary; today: string | null }) {
  const t = useT()
  const locale = useLocale()
  return (
    <span className="flex max-w-64 flex-wrap items-center gap-1 whitespace-normal">
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
      {lease.unitUnavailable ? (
        <span className="flex flex-wrap items-center gap-1" data-testid="pm-lease-unit-unavailable">
          <StatusBadge variant="warning">{t('property_management.leases.list.unitUnavailable', 'Unit unavailable')}</StatusBadge>
          <span className="text-xs text-muted-foreground">{unavailableSpan(t, lease, locale, leaseToday({ today }))}</span>
        </span>
      ) : null}
      {lease.billingAttention ? (
        <AlertTriangle className="size-4 text-status-warning-icon" aria-label={t('property_management.leases.billing.attention', 'Billing needs attention')} />
      ) : null}
    </span>
  )
}

function unavailableSpan(t: ReturnType<typeof useT>, lease: LeaseSummary, locale: string, today: string): string {
  const until = lease.unitUnavailableUntil ? formatDate(lastDayOf(lease.unitUnavailableUntil), locale) : null
  if (lease.unitUnavailableFrom && lease.unitUnavailableFrom.slice(0, 10) > today) {
    const from = formatDate(lease.unitUnavailableFrom, locale)
    return until
      ? t('property_management.leases.list.unavailableFromUntil', 'from {from} until {until}', { from, until })
      : t('property_management.leases.list.unavailableFromOpenEnded', 'from {date} until further notice', { date: from })
  }
  if (!until) return t('property_management.leases.list.unavailableOpenEnded', 'until further notice')
  return t('property_management.leases.list.unavailableUntil', 'until {date}', { date: until })
}

export default LeasesListPage
