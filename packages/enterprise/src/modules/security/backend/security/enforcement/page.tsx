'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation.js'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { EnforcementPoliciesResponse, EnforcementPolicyDto } from './_shared'

const PAGE_SIZE = 20

function buildTargetLabel(policy: EnforcementPolicyDto, allTenantsLabel: string): string {
  if (policy.scope === 'platform') return allTenantsLabel
  if (policy.scope === 'tenant') return policy.tenantName ?? policy.tenantId ?? '-'
  return `${policy.tenantName ?? policy.tenantId ?? '-'} / ${policy.organizationName ?? policy.organizationId ?? '-'}`
}

function renderTargetLabel(policy: EnforcementPolicyDto, allTenantsLabel: string) {
  if (policy.scope === 'platform') {
    return <span>{allTenantsLabel}</span>
  }

  const tenantLabel = policy.tenantName ?? policy.tenantId ?? '-'
  if (policy.scope === 'tenant') {
    return <span className="whitespace-normal break-words">{tenantLabel}</span>
  }

  const organizationLabel = policy.organizationName ?? policy.organizationId ?? '-'
  return (
    <div className="space-y-1 whitespace-normal break-words">
      <div>{tenantLabel}</div>
      <div className="text-muted-foreground">{organizationLabel}</div>
    </div>
  )
}

export default function SecurityEnforcementPage() {
  const router = useRouter()
  const t = useT()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'deadline', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [policies, setPolicies] = React.useState<EnforcementPolicyDto[]>([])
  const [saving, setSaving] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'security-enforcement-management',
  })

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { retryLastMutation },
      })
    },
    [retryLastMutation, runMutation],
  )

  const loadPolicies = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const response = await apiCall<EnforcementPoliciesResponse>('/api/security/enforcement')
    if (!response.ok || !response.result) {
      setPolicies([])
      setError(
        t(
          'security.admin.enforcement.errors.load',
          'Failed to load enforcement policies.',
        ),
      )
      setLoading(false)
      return
    }

    setPolicies(Array.isArray(response.result.items) ? response.result.items : [])
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void loadPolicies()
  }, [loadPolicies])

  const filteredPolicies = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const selectedScope = typeof filterValues.scope === 'string' ? filterValues.scope : ''
    const selectedStatus = typeof filterValues.status === 'string' ? filterValues.status : ''

    return policies.filter((policy) => {
      if (selectedScope && policy.scope !== selectedScope) return false
      if (selectedStatus === 'enforced' && !policy.isEnforced) return false
      if (selectedStatus === 'disabled' && policy.isEnforced) return false

      if (!normalizedSearch) return true
      const searchableChunks = [
        policy.scope,
        policy.tenantId ?? '',
        policy.tenantName ?? '',
        policy.organizationId ?? '',
        policy.organizationName ?? '',
        policy.allowedMethods?.join(',') ?? '',
        buildTargetLabel(policy, t('security.admin.enforcement.target.platform', 'All tenants')),
      ]
      return searchableChunks.some((chunk) => chunk.toLowerCase().includes(normalizedSearch))
    })
  }, [filterValues.scope, filterValues.status, policies, search, t])

  const total = filteredPolicies.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const pagedPolicies = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredPolicies.slice(start, start + PAGE_SIZE)
  }, [filteredPolicies, page])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'scope',
      label: t('security.admin.enforcement.list.scope', 'Scope'),
      type: 'select',
      options: [
        { value: '', label: t('ui.filters.all', 'All') },
        { value: 'platform', label: t('security.admin.enforcement.scope.platform', 'Platform') },
        { value: 'tenant', label: t('security.admin.enforcement.scope.tenant', 'Tenant') },
        { value: 'organisation', label: t('security.admin.enforcement.scope.organisation', 'Organisation') },
      ],
    },
    {
      id: 'status',
      label: t('security.admin.enforcement.list.status', 'Status'),
      type: 'select',
      options: [
        { value: '', label: t('ui.filters.all', 'All') },
        { value: 'enforced', label: t('security.admin.enforcement.status.enforced', 'Enforced') },
        { value: 'disabled', label: t('security.admin.enforcement.status.disabled', 'Disabled') },
      ],
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<EnforcementPolicyDto>[]>(() => [
    {
      accessorKey: 'scope',
      header: t('security.admin.enforcement.list.scope', 'Scope'),
      cell: ({ row }) => t(`security.admin.enforcement.scope.${row.original.scope}`, row.original.scope),
    },
    {
      id: 'target',
      header: t('security.admin.enforcement.list.target', 'Target'),
      cell: ({ row }) => renderTargetLabel(
        row.original,
        t('security.admin.enforcement.target.platform', 'All tenants'),
      ),
    },
    {
      id: 'deadline',
      header: t('security.admin.enforcement.list.deadline', 'Deadline'),
      cell: ({ row }) => row.original.enforcementDeadline
        ? new Date(row.original.enforcementDeadline).toLocaleString()
        : t('security.admin.enforcement.deadline.none', 'No deadline'),
    },
    {
      id: 'methods',
      header: t('security.admin.enforcement.list.methods', 'Allowed methods'),
      cell: ({ row }) => row.original.allowedMethods?.length
        ? row.original.allowedMethods.join(', ')
        : t('security.admin.enforcement.methods.all', 'All'),
    },
    {
      id: 'status',
      header: t('security.admin.enforcement.list.status', 'Status'),
      cell: ({ row }) => row.original.isEnforced
        ? t('security.admin.enforcement.status.enforced', 'Enforced')
        : t('security.admin.enforcement.status.disabled', 'Disabled'),
    },
  ], [t])

  const handleDelete = React.useCallback(async (policy: EnforcementPolicyDto) => {
    const accepted = await confirm({
      title: t('security.admin.enforcement.delete.title', 'Delete enforcement policy?'),
      text: t(
        'security.admin.enforcement.delete.text',
        'This removes the selected policy. Continue?',
      ),
      variant: 'destructive',
      confirmText: t('ui.actions.delete', 'Delete'),
      cancelText: t('ui.actions.cancel', 'Cancel'),
    })

    if (!accepted) return

    setSaving(true)
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/security/enforcement/${encodeURIComponent(policy.id)}`, {
            method: 'DELETE',
          }),
        { id: policy.id },
      )
      flash(t('security.admin.enforcement.flash.deleted', 'Enforcement policy deleted.'), 'success')
      await loadPolicies()
    } catch {
      flash(t('security.admin.enforcement.flash.deleteError', 'Failed to delete enforcement policy.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [confirm, loadPolicies, runMutationWithContext, t])

  return (
    <Page>
      <PageBody>
        <DataTable<EnforcementPolicyDto>
          title={t('security.admin.enforcement.list.title', 'Existing policies')}
          actions={(
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/backend/security/enforcement/create">
                {t('security.admin.enforcement.list.new', 'Create new policy')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={pagedPolicies}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('security.admin.enforcement.search', 'Search policies...')}
          filters={filterDefs}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          onRowClick={(policy) => {
            router.push(`/backend/security/enforcement/${encodeURIComponent(policy.id)}`)
          }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          refreshButton={{
            label: t('ui.actions.refresh', 'Refresh'),
            onRefresh: () => void loadPolicies(),
            isRefreshing: loading,
          }}
          perspective={{ tableId: 'security.enforcement.list' }}
          isLoading={loading}
          error={error ? (
            <div className="flex items-center justify-center gap-3">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadPolicies()}>
                {t('ui.actions.retry', 'Retry')}
              </Button>
            </div>
          ) : null}
          emptyState={t('security.admin.enforcement.empty', 'No enforcement policies found.')}
          rowActions={(policy) => (
            <div className="flex items-center gap-1">
              <IconButton
                asChild
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('ui.actions.edit', 'Edit')}
                title={t('ui.actions.edit', 'Edit')}
              >
                <Link href={`/backend/security/enforcement/${encodeURIComponent(policy.id)}`}>
                  <Pencil className="size-4" />
                </Link>
              </IconButton>
              <IconButton
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('ui.actions.delete', 'Delete')}
                title={t('ui.actions.delete', 'Delete')}
                onClick={() => void handleDelete(policy)}
                disabled={saving}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          )}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
