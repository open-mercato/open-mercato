'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import MfaComplianceBadge from '../../../components/MfaComplianceBadge'
import type { ComplianceItem, ComplianceResponse } from './_shared'
import { Button } from '@open-mercato/ui/primitives/button'

const PAGE_SIZE = 20

function formatLastLogin(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toLocaleString()
}

export default function SecurityUsersPage() {
  const router = useRouter()
  const t = useT()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'email', desc: false }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<ComplianceItem[]>([])

  const loadUsers = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const response = await apiCall<ComplianceResponse>('/api/security/users/mfa/compliance')
    if (!response.ok || !response.result) {
      setItems([])
      setError(t('security.admin.users.errors.load', 'Failed to load user compliance data.'))
      setLoading(false)
      return
    }

    setItems(Array.isArray(response.result.items) ? response.result.items : [])
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const filteredItems = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const enrolledFilter = typeof filterValues.enrolled === 'string' ? filterValues.enrolled : ''
    const compliantFilter = typeof filterValues.compliant === 'string' ? filterValues.compliant : ''

    return items.filter((item) => {
      if (enrolledFilter === 'true' && !item.enrolled) return false
      if (enrolledFilter === 'false' && item.enrolled) return false
      if (compliantFilter === 'true' && !item.compliant) return false
      if (compliantFilter === 'false' && item.compliant) return false

      if (!normalizedSearch) return true
      return (
        item.userId.toLowerCase().includes(normalizedSearch)
        || item.email.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [filterValues.compliant, filterValues.enrolled, items, search])

  const total = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const pagedItems = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, page])

  const columns = React.useMemo<ColumnDef<ComplianceItem>[]>(() => [
    {
      accessorKey: 'email',
      header: t('security.admin.users.table.email', 'Email'),
    },
    {
      id: 'mfaStatus',
      header: t('security.admin.users.table.mfaStatus', 'MFA status'),
      cell: ({ row }) => row.original.enrolled
        ? t('security.admin.users.mfa.enabled', 'Enabled')
        : t('security.admin.users.mfa.disabled', 'Not enrolled'),
    },
    {
      id: 'compliance',
      header: t('security.admin.users.table.compliance', 'Compliance'),
      cell: ({ row }) => (
        <MfaComplianceBadge enrolled={row.original.enrolled} compliant={row.original.compliant} />
      ),
    },
    {
      id: 'lastLogin',
      header: t('security.admin.users.table.lastLogin', 'Last login'),
      cell: ({ row }) => formatLastLogin(
        row.original.lastLoginAt,
        t('security.admin.users.lastLogin.unknown', 'Unknown'),
      ),
    },
  ], [t])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'enrolled',
      label: t('security.admin.users.table.mfaStatus', 'MFA status'),
      type: 'select',
      options: [
        { value: '', label: t('ui.filters.all', 'All') },
        { value: 'true', label: t('security.admin.users.mfa.enabled', 'Enabled') },
        { value: 'false', label: t('security.admin.users.mfa.disabled', 'Not enrolled') },
      ],
    },
    {
      id: 'compliant',
      label: t('security.admin.users.table.compliance', 'Compliance'),
      type: 'select',
      options: [
        { value: '', label: t('ui.filters.all', 'All') },
        { value: 'true', label: t('ui.common.yes', 'Yes') },
        { value: 'false', label: t('ui.common.no', 'No') },
      ],
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<ComplianceItem>
          title={t('security.admin.users.table.title', 'Users')}
          columns={columns}
          data={pagedItems}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('security.admin.users.search', 'Search users...')}
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
          onRowClick={(item) => {
            router.push(`/backend/security/users/${encodeURIComponent(item.userId)}`)
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
            onRefresh: () => void loadUsers(),
            isRefreshing: loading,
          }}
          perspective={{ tableId: 'security.users.list' }}
          isLoading={loading}
          error={error ? (
            <div className="flex items-center justify-center gap-3">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadUsers()}>
                {t('ui.actions.retry', 'Retry')}
              </Button>
            </div>
          ) : null}
          emptyState={t('security.admin.users.empty', 'No users found for this tenant.')}
        />
      </PageBody>
    </Page>
  )
}
