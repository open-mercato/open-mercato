"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { normalizeVendorPolicy, type VendorPolicyRecord } from './vendorPolicyForm'

type VendorPoliciesResponse = {
  items?: unknown[]
  total?: number
  totalPages?: number
  error?: string
}

const PAGE_SIZE = 20

function shortId(value: string | null): string {
  if (!value) return ''
  return value.length > 8 ? value.slice(0, 8) : value
}

function formatCoverageMonths(value: number | null, t: TranslateFn): string {
  if (value === null) return t('warranty_claims.common.noValue', 'Not set')
  return t('warranty_claims.vendorPolicies.list.months', '{count} months', { count: value })
}

function formatReasonCodes(value: string[] | null, t: TranslateFn): string {
  if (!value?.length) return t('warranty_claims.vendorPolicies.list.anyReason', 'Any reason')
  return value.join(', ')
}

function formatRecoveryRate(value: string | null, t: TranslateFn): string {
  if (!value) return t('warranty_claims.common.noValue', 'Not set')
  return `${value}%`
}

function activeLabel(value: boolean, t: TranslateFn): string {
  return value
    ? t('warranty_claims.vendorPolicies.status.active', 'Active')
    : t('warranty_claims.vendorPolicies.status.inactive', 'Inactive')
}

function autoLabel(value: boolean, t: TranslateFn): string {
  return value
    ? t('warranty_claims.vendorPolicies.status.auto', 'Automatic')
    : t('warranty_claims.vendorPolicies.status.manual', 'Manual')
}

function toFilterString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

export default function WarrantyVendorPoliciesPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<VendorPolicyRecord[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const mutationContextId = 'warranty-claim-vendor-policies-list'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('warranty_claims.vendorPolicies.list.error.blocked', 'Save blocked by validation.'),
  })

  const reload = React.useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadPolicies() {
      setLoading(true)
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortField: 'updatedAt',
        sortDir: 'desc',
      })
      if (search.trim()) params.set('search', search.trim())
      const isActive = toFilterString(filterValues.isActive)
      if (isActive) params.set('isActive', isActive)
      try {
        const fallback: VendorPoliciesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<VendorPoliciesResponse>(
          `/api/warranty_claims/vendor-policies?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const message = call.result?.error ?? t('warranty_claims.vendorPolicies.list.error.load', 'Failed to load vendor policies.')
          flash(message, 'error')
          return
        }
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRows(items.map(normalizeVendorPolicy).filter((row): row is VendorPolicyRecord => row !== null))
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error
            ? error.message
            : t('warranty_claims.vendorPolicies.list.error.load', 'Failed to load vendor policies.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadPolicies()
    return () => {
      cancelled = true
    }
  }, [filterValues.isActive, page, reloadToken, scopeVersion, search, t])

  const handleDelete = React.useCallback(async (policy: VendorPolicyRecord) => {
    const confirmed = await confirm({
      title: t('warranty_claims.vendorPolicies.confirm.deleteTitle', 'Delete this vendor policy?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(policy.updatedAt),
            () => deleteCrud('warranty_claims/vendor-policies', policy.id, {
              errorMessage: t('warranty_claims.vendorPolicies.list.error.delete', 'Failed to delete vendor policy.'),
            }),
          )
          return call
        },
        mutationPayload: { id: policy.id },
        context: {
          formId: mutationContextId,
          resourceKind: 'warranty_claims.warranty_vendor_policy',
          resourceId: policy.id,
          retryLastMutation,
        },
      })
      flash(t('warranty_claims.vendorPolicies.list.success.delete', 'Vendor policy deleted.'), 'success')
      reload()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(
        error instanceof Error
          ? error.message
          : t('warranty_claims.vendorPolicies.list.error.delete', 'Failed to delete vendor policy.'),
        'error',
      )
    }
  }, [confirm, mutationContextId, reload, retryLastMutation, runMutation, t])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'isActive',
      label: t('warranty_claims.vendorPolicies.list.filter.status', 'Status'),
      type: 'select',
      options: [
        { value: 'true', label: t('warranty_claims.vendorPolicies.status.active', 'Active') },
        { value: 'false', label: t('warranty_claims.vendorPolicies.status.inactive', 'Inactive') },
      ],
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<VendorPolicyRecord>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('warranty_claims.common.noValue', 'Not set')}</span>
    return [
      {
        accessorKey: 'vendorName',
        header: t('warranty_claims.vendorPolicies.list.column.vendor', 'Vendor'),
        meta: { alwaysVisible: true, truncate: true, maxWidth: '240px' },
        cell: ({ row }) => (
          <Link
            href={`/backend/warranty_claims/vendor-policies/${row.original.id}/edit`}
            className="font-medium hover:underline"
          >
            {row.original.vendorName ?? shortId(row.original.id)}
          </Link>
        ),
      },
      {
        accessorKey: 'vendorRef',
        header: t('warranty_claims.vendorPolicies.list.column.vendorRef', 'Reference'),
        meta: { truncate: true, maxWidth: '180px' },
        cell: ({ row }) => row.original.vendorRef ? <span>{row.original.vendorRef}</span> : noValue,
      },
      {
        accessorKey: 'coverageMonths',
        header: t('warranty_claims.vendorPolicies.list.column.coverageMonths', 'Coverage'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatCoverageMonths(row.original.coverageMonths, t)}
          </span>
        ),
      },
      {
        accessorKey: 'claimableReasonCodes',
        header: t('warranty_claims.vendorPolicies.list.column.reasons', 'Reasons'),
        meta: { truncate: true, maxWidth: '260px' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatReasonCodes(row.original.claimableReasonCodes, t)}
          </span>
        ),
      },
      {
        accessorKey: 'recoveryRatePct',
        header: t('warranty_claims.vendorPolicies.list.column.recoveryRate', 'Recovery'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatRecoveryRate(row.original.recoveryRatePct, t)}
          </span>
        ),
      },
      {
        accessorKey: 'autoGenerateRecovery',
        header: t('warranty_claims.vendorPolicies.list.column.auto', 'Mode'),
        cell: ({ row }) => (
          <StatusBadge variant={row.original.autoGenerateRecovery ? 'warning' : 'neutral'}>
            {autoLabel(row.original.autoGenerateRecovery, t)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('warranty_claims.vendorPolicies.list.column.active', 'Status'),
        cell: ({ row }) => (
          <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'}>
            {activeLabel(row.original.isActive, t)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('warranty_claims.vendorPolicies.list.column.updated', 'Updated'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateTime(row.original.updatedAt) ?? t('warranty_claims.common.noValue', 'Not set')}
          </span>
        ),
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<VendorPolicyRecord>
          stickyFirstColumn
          stickyActionsColumn
          title={t('warranty_claims.vendorPolicies.list.title', 'Vendor policies')}
          refreshButton={{
            label: t('warranty_claims.vendorPolicies.list.actions.refresh', 'Refresh'),
            onRefresh: reload,
            isRefreshing: loading,
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/warranty_claims/vendor-policies/create">
                {t('warranty_claims.vendorPolicies.list.actions.new', 'New vendor policy')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('warranty_claims.vendorPolicies.list.searchPlaceholder', 'Search vendor or reference')}
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
          onRowClick={(row) => router.push(`/backend/warranty_claims/vendor-policies/${row.id}/edit`)}
          isLoading={loading}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('warranty_claims.vendorPolicies.list.actions.edit', 'Edit'),
                  onSelect: () => router.push(`/backend/warranty_claims/vendor-policies/${row.id}/edit`),
                },
                {
                  id: 'delete',
                  label: t('warranty_claims.vendorPolicies.list.actions.delete', 'Delete'),
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
              title={t('warranty_claims.vendorPolicies.list.empty.title', 'No vendor policies yet')}
              description={t('warranty_claims.vendorPolicies.list.empty.description', 'Create policies to suggest or automate supplier recovery for resolved claim lines.')}
              createHref="/backend/warranty_claims/vendor-policies/create"
              createLabel={t('warranty_claims.vendorPolicies.list.actions.new', 'New vendor policy')}
            />
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
