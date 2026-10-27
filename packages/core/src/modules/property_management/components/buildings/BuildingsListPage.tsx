"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Building2, Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeBuilding, type BuildingListPayload, type BuildingRecord } from './buildingRecord'
import { BuildingDeleteDialog, type BuildingDeleteTarget } from './BuildingDeleteDialog'
import { BuildingArchiveDialog } from './BuildingArchiveDialog'

const PAGE_SIZE = 50
const BASE_HREF = '/backend/property_management/buildings'

type ListState = { rows: BuildingRecord[]; total: number; totalPages: number; archivedCount: number; canManageAll: boolean }

const EMPTY_LIST: ListState = { rows: [], total: 0, totalPages: 1, archivedCount: 0, canManageAll: true }

export function BuildingsListPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [list, setList] = React.useState<ListState>(EMPTY_LIST)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [showArchived, setShowArchived] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dialog, setDialog] = React.useState<{ kind: 'delete' | 'archive'; target: BuildingDeleteTarget } | null>(null)

  const reload = React.useCallback(() => setReloadToken((current) => current + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortField: 'name', sortDir: 'asc' })
    if (search.trim()) params.set('search', search.trim())
    if (showArchived) params.set('status', 'archived')
    void apiCall<BuildingListPayload>(`/api/property_management/buildings?${params.toString()}`, undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          flash(call.result?.error ?? t('property_management.buildings.list.loadError', 'Could not load buildings.'), 'error')
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setList({
          rows: items.map(normalizeBuilding).filter((row): row is BuildingRecord => row !== null),
          total: typeof call.result?.total === 'number' ? call.result.total : items.length,
          totalPages: typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1,
          archivedCount: typeof call.result?.archivedCount === 'number' ? call.result.archivedCount : 0,
          canManageAll: call.result?.canManageAll === true,
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, search, showArchived, reloadToken, scopeVersion, t])

  const totals = React.useMemo(() => list.rows.reduce(
    (sum, row) => ({ floors: sum.floors + row.floorCount, spaces: sum.spaces + row.spaceCount, units: sum.units + row.unitCount }),
    { floors: 0, spaces: 0, units: 0 },
  ), [list.rows])

  const columns = React.useMemo<ColumnDef<BuildingRecord>[]>(() => [
    {
      accessorKey: 'name',
      header: t('property_management.buildings.list.column.name', 'Building'),
      meta: { alwaysVisible: true, maxWidth: '240px' },
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Link href={`${BASE_HREF}/${row.original.id}`} className="font-medium hover:underline">{row.original.name}</Link>
          {row.original.status === 'archived' ? (
            <StatusBadge variant="neutral">{t('property_management.buildings.list.archived', 'Archived')}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: 'address',
      header: t('property_management.buildings.list.column.address', 'Address'),
      meta: { truncate: true, maxWidth: '320px' },
    },
    { accessorKey: 'floorCount', header: t('property_management.buildings.list.column.floors', 'Floors'), meta: { maxWidth: '90px' } },
    { accessorKey: 'spaceCount', header: t('property_management.buildings.list.column.spaces', 'Spaces'), meta: { maxWidth: '90px' } },
    { accessorKey: 'unitCount', header: t('property_management.buildings.list.column.units', 'Units'), meta: { maxWidth: '90px' } },
  ], [t])

  const noAssignment = !loading && !list.canManageAll && list.total === 0 && !search.trim() && !showArchived

  const summary = t('property_management.buildings.list.summary', '{floors} floors · {spaces} spaces · {units} units', totals)
  const archivedNote = list.archivedCount > 0 && !showArchived
    ? t('property_management.buildings.list.archivedHidden', '{count} archived not shown', { count: list.archivedCount })
    : null

  return (
    <Page>
      <PageBody>
        {noAssignment ? (
          <EmptyState
            icon={<Building2 className="size-6" aria-hidden />}
            title={t('property_management.buildings.list.noAssignment.title', 'No buildings assigned to you')}
            description={t(
              'property_management.buildings.list.noAssignment.description',
              'You only see the buildings you manage, and none are assigned to you yet. Ask an administrator to add you as a manager of your buildings.',
            )}
          />
        ) : (
          <DataTable<BuildingRecord>
            title={t('property_management.buildings.list.title', 'Buildings')}
            titleHeadingLevel={1}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground" data-testid="pm-buildings-summary">
                  {t('property_management.buildings.list.count', '{count} buildings', { count: list.total })} · {summary}
                  {archivedNote ? ` · ${archivedNote}` : ''}
                </span>
                {list.archivedCount > 0 || showArchived ? (
                  <Button type="button" variant="outline" onClick={() => { setShowArchived((current) => !current); setPage(1) }}>
                    {showArchived
                      ? t('property_management.buildings.list.showActive', 'Show active')
                      : t('property_management.buildings.list.showArchived', 'Show archived')}
                  </Button>
                ) : null}
                <Button asChild>
                  <Link href={`${BASE_HREF}/create`}>
                    <Plus className="size-4" aria-hidden />
                    {t('property_management.buildings.list.new', 'New building')}
                  </Link>
                </Button>
              </div>
            )}
            refreshButton={{ label: t('property_management.common.refresh', 'Refresh'), onRefresh: reload, isRefreshing: loading }}
            columns={columns}
            data={list.rows}
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(1) }}
            searchPlaceholder={t('property_management.buildings.list.search', 'Search buildings')}
            isLoading={loading}
            onRowClick={(row) => router.push(`${BASE_HREF}/${row.id}`)}
            rowActions={(row) => (
              <RowActions
                items={[
                  { id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`${BASE_HREF}/${row.id}`) },
                  ...(row.status === 'archived' ? [] : [{
                    id: 'delete',
                    label: t('property_management.common.delete', 'Delete'),
                    destructive: true,
                    onSelect: () => setDialog({ kind: 'delete', target: { id: row.id, name: row.name, updatedAt: row.updatedAt } }),
                  }]),
                ]}
              />
            )}
            emptyState={(
              <ListEmptyState
                title={t('property_management.buildings.list.empty.title', 'No buildings yet')}
                description={t('property_management.buildings.list.empty.description', 'Add a location and lay out its floors.')}
                createHref={`${BASE_HREF}/create`}
                createLabel={t('property_management.buildings.list.new', 'New building')}
              />
            )}
            pagination={{ page, pageSize: PAGE_SIZE, total: list.total, totalPages: list.totalPages, onPageChange: setPage }}
          />
        )}
        <BuildingDeleteDialog
          target={dialog?.kind === 'delete' ? dialog.target : null}
          onClose={() => setDialog(null)}
          onDeleted={() => { setDialog(null); reload() }}
          onArchiveInstead={() => setDialog((current) => (current ? { kind: 'archive', target: current.target } : null))}
        />
        <BuildingArchiveDialog
          target={dialog?.kind === 'archive' ? dialog.target : null}
          onClose={() => setDialog(null)}
          onArchived={() => { setDialog(null); reload() }}
        />
      </PageBody>
    </Page>
  )
}

export default BuildingsListPage
