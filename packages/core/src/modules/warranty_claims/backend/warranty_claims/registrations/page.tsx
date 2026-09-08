"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type BulkAction, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { runBulkDelete } from '@open-mercato/ui/backend/utils/bulkDelete'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Plus } from 'lucide-react'
import { REGISTRATION_COVERAGE_TYPES, REGISTRATION_SOURCES } from '../../../data/validators'
import { normalizeRegistration, type RegistrationRecord } from './registrationForm'
import { WarrantyWorkspace } from '../../components/WarrantyWorkspace'
import { extensionPoints } from '../../../extension-points'

type RegistrationsResponse = {
  items?: unknown[]
  total?: number
  totalPages?: number
  totalIsCapped?: boolean
  error?: string
}

const PAGE_SIZE = 20
type RegistrationSegment = 'all' | 'standard' | 'extended' | 'expiring' | 'none'

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function getCustomerDisplayName(record: Record<string, unknown>): string | null {
  return toStringOrNull(record.display_name) ?? toStringOrNull(record.displayName)
}

function useCustomerDisplayNames(customerIds: readonly (string | null | undefined)[]): Record<string, string> {
  const [customerNames, setCustomerNames] = React.useState<Record<string, string>>({})
  const resolvedCustomerIdsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    const unresolvedIds = new Set<string>()
    for (const customerId of customerIds) {
      const normalized = toStringOrNull(customerId)
      if (normalized && !resolvedCustomerIdsRef.current.has(normalized)) {
        unresolvedIds.add(normalized)
      }
    }
    if (!unresolvedIds.size) return

    for (const customerId of unresolvedIds) resolvedCustomerIdsRef.current.add(customerId)

    const controller = new AbortController()
    const idsParam = [...unresolvedIds].map(encodeURIComponent).join(',')
    Promise.all([
      readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/customers/people?ids=${idsParam}&pageSize=100`,
        { signal: controller.signal },
        { fallback: { items: [] }, errorMessage: '[internal] Failed to load customer display names' },
      ),
      readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/customers/companies?ids=${idsParam}&pageSize=100`,
        { signal: controller.signal },
        { fallback: { items: [] }, errorMessage: '[internal] Failed to load customer display names' },
      ),
    ])
      .then(([people, companies]) => {
        const nextNames: Record<string, string> = {}
        for (const record of [...(people.items ?? []), ...(companies.items ?? [])]) {
          const customerId = toStringOrNull(record.id)
          const displayName = getCustomerDisplayName(record)
          if (customerId && displayName) nextNames[customerId] = displayName
        }
        if (Object.keys(nextNames).length) {
          setCustomerNames((current) => ({ ...current, ...nextNames }))
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [customerIds])

  return customerNames
}

function coverageVariant(value: string | null): 'success' | 'warning' | 'neutral' {
  if (value === 'standard') return 'success'
  if (value === 'extended') return 'warning'
  return 'neutral'
}

function coverageLabel(value: string | null, t: TranslateFn): string {
  if (value === 'standard') return t('warranty_claims.registrations.coverageType.standard', 'Standard')
  if (value === 'extended') return t('warranty_claims.registrations.coverageType.extended', 'Extended')
  if (value === 'none') return t('warranty_claims.registrations.coverageType.none', 'No coverage')
  return t('warranty_claims.common.noValue', 'Not set')
}

function sourceLabel(value: string | null, t: TranslateFn): string {
  if (value === 'order') return t('warranty_claims.registrations.source.order', 'Order')
  if (value === 'manual') return t('warranty_claims.registrations.source.manual', 'Manual')
  if (value === 'third_party') return t('warranty_claims.registrations.source.thirdParty', 'Third party')
  return t('warranty_claims.common.noValue', 'Not set')
}

function registrationSegmentQuery(segment: RegistrationSegment): Record<string, string> {
  if (segment === 'standard' || segment === 'extended' || segment === 'none') return { coverageType: segment }
  if (segment === 'expiring') return { expiry: 'expiring_30d' }
  return {}
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(locale || undefined)
}

function hasExpired(value: string | null): boolean {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

export default function WarrantyClaimRegistrationsPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<RegistrationRecord[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [tabCounts, setTabCounts] = React.useState<Partial<Record<RegistrationSegment, number>>>({})
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const customerIds = React.useMemo(() => rows.map((row) => row.customerId), [rows])
  const customerNames = useCustomerDisplayNames(customerIds)

  const mutationContextId = 'warranty-claim-registrations-list'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('warranty_claims.registrations.list.error.blocked', 'Save blocked by validation.'),
  })

  const reload = React.useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  const listQueryString = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: 'updatedAt',
      sortDir: 'desc',
    })
    if (search.trim()) params.set('search', search.trim())
    const coverageType = toStringOrNull(filterValues.coverageType)
    if (coverageType) params.set('coverageType', coverageType)
    const source = toStringOrNull(filterValues.source)
    if (source) params.set('source', source)
    const expiry = toStringOrNull(filterValues.expiry)
    if (expiry) params.set('expiry', expiry)
    return params.toString()
  }, [filterValues, page, search])

  const currentParams = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(listQueryString)),
    [listQueryString],
  )

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('warranty_claims/registrations', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('warranty_claims/registrations', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  React.useEffect(() => {
    let cancelled = false
    async function loadRegistrations() {
      setLoading(true)
      try {
        const fallback: RegistrationsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<RegistrationsResponse>(
          `/api/warranty_claims/registrations?${listQueryString}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const message = call.result?.error ?? t('warranty_claims.registrations.list.error.load', 'Failed to load warranty registrations.')
          flash(message, 'error')
          return
        }
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRows(items.map(normalizeRegistration).filter((row): row is RegistrationRecord => row !== null))
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
        setTotalIsCapped(call.result?.totalIsCapped === true)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error
            ? error.message
            : t('warranty_claims.registrations.list.error.load', 'Failed to load warranty registrations.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadRegistrations()
    return () => {
      cancelled = true
    }
  }, [listQueryString, reloadToken, scopeVersion, t])

  React.useEffect(() => {
    const controller = new AbortController()
    const segments: RegistrationSegment[] = ['all', 'standard', 'extended', 'expiring', 'none']
    Promise.all(segments.map(async (segment) => {
      const params = new URLSearchParams({ page: '1', pageSize: '1', ...registrationSegmentQuery(segment) })
      const fallback: RegistrationsResponse = { items: [], total: 0, totalPages: 1 }
      const call = await apiCall<RegistrationsResponse>(
        `/api/warranty_claims/registrations?${params.toString()}`,
        { signal: controller.signal },
        { fallback },
      )
      if (!call.ok) throw new Error('[internal] Failed to load registration counts')
      return [segment, typeof call.result?.total === 'number' ? call.result.total : 0] as const
    }))
      .then((entries) => {
        if (!controller.signal.aborted) setTabCounts(Object.fromEntries(entries))
      })
      .catch(() => {
        if (!controller.signal.aborted) setTabCounts({})
      })
    return () => controller.abort()
  }, [reloadToken, scopeVersion])

  const executeDelete = React.useCallback(async (registration: RegistrationRecord): Promise<unknown> => {
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(registration.updatedAt),
          () => deleteCrud('warranty_claims/registrations', registration.id, {
            errorMessage: t('warranty_claims.registrations.list.error.delete', 'Failed to delete warranty registration.'),
          }),
        ),
        mutationPayload: { id: registration.id },
        context: {
          formId: mutationContextId,
          resourceKind: 'warranty_claims.warranty_claim_registration',
          resourceId: registration.id,
          retryLastMutation,
        },
      })
      return null
    } catch (error) {
      return error
    }
  }, [mutationContextId, retryLastMutation, runMutation, t])

  const handleDelete = React.useCallback(async (registration: RegistrationRecord) => {
    const confirmed = await confirm({
      title: t('warranty_claims.registrations.confirm.deleteTitle', 'Delete this warranty registration?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const error = await executeDelete(registration)
    if (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(
        error instanceof Error
          ? error.message
          : t('warranty_claims.registrations.list.error.delete', 'Failed to delete warranty registration.'),
        'error',
      )
      return
    }
    flash(t('warranty_claims.registrations.list.success.delete', 'Warranty registration deleted.'), 'success')
    reload()
  }, [confirm, executeDelete, reload, t])

  const handleBulkDelete = React.useCallback(async (selectedRows: RegistrationRecord[]) => {
    const { succeeded, failures } = await runBulkDelete(
      selectedRows,
      async (registration) => {
        const error = await executeDelete(registration)
        if (error) throw error
      },
      {
        fallbackErrorMessage: t('warranty_claims.registrations.list.error.delete', 'Failed to delete warranty registration.'),
        logTag: 'warranty_claims.registrations.list',
        progress: {
          jobType: 'warranty_claims.registrations.bulk_delete',
          name: t('warranty_claims.registrations.bulk.delete', 'Delete selected'),
        },
      },
    )
    const summary = t(
      'warranty_claims.bulk.summary',
      'Bulk action finished: {succeeded} succeeded, {failed} failed.',
      { succeeded: succeeded.length, failed: failures.length },
    )
    if (failures.length) {
      flash(`${summary} ${t('warranty_claims.bulk.firstError', 'First error: {message}', { message: failures[0].message })}`, 'warning')
    } else {
      flash(summary, 'success')
    }
    reload()
    return { ok: true as const, affectedCount: succeeded.length }
  }, [executeDelete, reload, t])

  const bulkActions = React.useMemo<BulkAction<RegistrationRecord>[]>(() => [
    {
      id: 'bulk-delete',
      label: t('warranty_claims.registrations.bulk.delete', 'Delete selected'),
      destructive: true,
      onExecute: async (selectedRows) => {
        if (!selectedRows.length) return false
        const confirmed = await confirm({
          title: t('warranty_claims.registrations.bulk.deleteTitle', 'Delete selected warranty registrations?'),
          variant: 'destructive',
        })
        if (!confirmed) return false
        return handleBulkDelete(selectedRows)
      },
    },
  ], [confirm, handleBulkDelete, t])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'coverageType',
      label: t('warranty_claims.registrations.list.filter.coverageType', 'Coverage'),
      type: 'select',
      options: REGISTRATION_COVERAGE_TYPES.map((value) => ({ value, label: coverageLabel(value, t) })),
    },
    {
      id: 'source',
      label: t('warranty_claims.registrations.list.filter.source', 'Source'),
      type: 'select',
      options: REGISTRATION_SOURCES.map((value) => ({ value, label: sourceLabel(value, t) })),
    },
    {
      id: 'expiry',
      label: t('warranty_claims.registrations.list.filter.expiry', 'Warranty expiry'),
      type: 'select',
      options: [
        { value: 'expired', label: t('warranty_claims.registrations.list.expiry.expired', 'Expired') },
        { value: 'expiring_30d', label: t('warranty_claims.registrations.list.expiry.expiringSoon', 'Expiring in 30 days') },
        { value: 'active', label: t('warranty_claims.registrations.list.expiry.active', 'Active') },
      ],
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<RegistrationRecord>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('warranty_claims.common.noValue', 'Not set')}</span>
    return [
      {
        accessorKey: 'serialNumber',
        header: t('warranty_claims.registrations.list.column.serial', 'Serial'),
        meta: { alwaysVisible: true, maxWidth: '150px' },
        cell: ({ row }) => (
          <Link
            href={`/backend/warranty_claims/registrations/${row.original.id}/edit`}
            className="font-medium hover:underline"
          >
            {row.original.serialNumber ?? '—'}
          </Link>
        ),
      },
      {
        accessorKey: 'productName',
        header: t('warranty_claims.registrations.list.column.product', 'Product'),
        meta: { truncate: true, maxWidth: '260px' },
        cell: ({ row }) => row.original.productName ? <span>{row.original.productName}</span> : noValue,
      },
      {
        accessorKey: 'customerId',
        header: t('warranty_claims.registrations.list.column.customer', 'Customer'),
        meta: { maxWidth: '190px' },
        cell: ({ row }) => {
          const customerId = row.original.customerId
          const displayName = customerId ? customerNames[customerId] : undefined
          return displayName
            ? <span>{displayName}</span>
            : <span className="text-sm text-muted-foreground">—</span>
        },
      },
      {
        accessorKey: 'coverageType',
        header: t('warranty_claims.registrations.list.column.coverage', 'Coverage'),
        meta: { maxWidth: '140px' },
        cell: ({ row }) => (
          <StatusBadge variant={coverageVariant(row.original.coverageType)}>
            {coverageLabel(row.original.coverageType, t)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'warrantyExpiresAt',
        header: t('warranty_claims.registrations.list.column.warrantyExpiry', 'Warranty expiry'),
        cell: ({ row }) => (
          <span className={hasExpired(row.original.warrantyExpiresAt) ? 'text-sm text-status-error-text' : 'text-sm text-muted-foreground'}>
            {formatDate(row.original.warrantyExpiresAt, locale) ?? t('warranty_claims.common.noValue', 'Not set')}
          </span>
        ),
      },
      {
        accessorKey: 'source',
        header: t('warranty_claims.registrations.list.column.source', 'Source'),
        meta: { maxWidth: '110px' },
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{sourceLabel(row.original.source, t)}</span>,
      },
    ]
  }, [customerNames, locale, t])

  const activeTab = toStringOrNull(filterValues.coverageType) === 'standard'
    ? 'standard'
    : toStringOrNull(filterValues.coverageType) === 'extended'
      ? 'extended'
      : toStringOrNull(filterValues.coverageType) === 'none'
        ? 'none'
        : toStringOrNull(filterValues.expiry) === 'expiring_30d'
          ? 'expiring'
          : 'all'

  const handleTabChange = React.useCallback((value: string) => {
    if (value === 'standard') setFilterValues({ coverageType: 'standard' })
    else if (value === 'extended') setFilterValues({ coverageType: 'extended' })
    else if (value === 'none') setFilterValues({ coverageType: 'none' })
    else if (value === 'expiring') setFilterValues({ expiry: 'expiring_30d' })
    else setFilterValues({})
    setPage(1)
  }, [])

  return (
    <Page>
      <PageBody>
        <WarrantyWorkspace
          title={t('warranty_claims.registrations.list.title', 'Warranty registrations')}
          action={(
            <Button asChild>
              <Link href="/backend/warranty_claims/registrations/create">
                <Plus className="size-4" aria-hidden />
                {t('warranty_claims.registrations.list.actions.add', 'Add registration')}
              </Link>
            </Button>
          )}
          contentClassName="[&>[data-component-handle]>div:first-child]:px-8 [&>[data-component-handle]>div:first-child]:py-4 [&_:has(>[data-slot=search-input-wrapper])]:lg:w-56"
          activeTab={activeTab}
          onTabChange={handleTabChange}
          tabs={[
            { id: 'all', label: t('warranty_claims.registrations.list.tabs.all', 'All'), count: tabCounts.all },
            { id: 'standard', label: t('warranty_claims.registrations.list.tabs.standard', 'Standard'), count: tabCounts.standard },
            { id: 'extended', label: t('warranty_claims.registrations.list.tabs.extended', 'Extended'), count: tabCounts.extended },
            { id: 'expiring', label: t('warranty_claims.registrations.list.tabs.expiring', 'Expiring in 30 days'), count: tabCounts.expiring },
            { id: 'none', label: t('warranty_claims.registrations.list.tabs.none', 'No coverage'), count: tabCounts.none },
          ]}
        >
          <DataTable<RegistrationRecord>
          embedded
          stickyFirstColumn
          stickyActionsColumn
          refreshButton={{
            label: t('warranty_claims.registrations.list.actions.refresh', 'Refresh'),
            onRefresh: reload,
            isRefreshing: loading,
          }}
          columns={columns}
          columnChooser={{ auto: true }}
          data={rows}
          exporter={exportConfig}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('warranty_claims.registrations.list.searchPlaceholder', 'Search serial, product or customer…')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          perspective={{ tableId: extensionPoints.hosts.registrationsTable.tableId }}
          onRowClick={(row) => router.push(`/backend/warranty_claims/registrations/${row.id}/edit`)}
          isLoading={loading}
          bulkActions={bulkActions}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('warranty_claims.registrations.list.actions.edit', 'Edit'),
                  onSelect: () => router.push(`/backend/warranty_claims/registrations/${row.id}/edit`),
                },
                {
                  id: 'delete',
                  label: t('warranty_claims.registrations.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              title={t('warranty_claims.registrations.list.empty.title', 'No warranty registrations yet')}
              description={t('warranty_claims.registrations.list.empty.description', 'Create a registration to resolve warranty entitlement by serial number.')}
              createHref="/backend/warranty_claims/registrations/create"
              createLabel={t('warranty_claims.registrations.list.actions.new', 'New registration')}
            />
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            totalIsCapped,
            onPageChange: setPage,
          }}
          />
        </WarrantyWorkspace>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
