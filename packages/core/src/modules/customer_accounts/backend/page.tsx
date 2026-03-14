"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type UserRow = {
  id: string
  displayName: string
  email: string
  emailVerified: boolean
  isActive: boolean
  lastLoginAt: string | null
  roles: Array<{ id: string; name: string; slug: string }>
  createdAt: string
  personEntityId: string | null
  customerEntityId: string | null
}

type UsersResponse = {
  items?: UserRow[]
  total?: number
  totalPages?: number
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString()
}

async function fetchRoleFilterOptions(): Promise<Array<{ value: string; label: string }>> {
  try {
    const call = await apiCall<{ items?: Array<{ id: string; name: string }> }>(
      '/api/customer_accounts/admin/roles?pageSize=100',
    )
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result!.items : []
    return items
      .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string')
      .map((item) => ({ value: item.id, label: item.name }))
  } catch {
    return []
  }
}

export default function CustomerAccountsPage() {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<UserRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [roleOptions, setRoleOptions] = React.useState<Array<{ value: string; label: string }>>([])

  React.useEffect(() => {
    let cancelled = false
    fetchRoleFilterOptions().then((opts) => {
      if (!cancelled) setRoleOptions(opts)
    })
    return () => { cancelled = true }
  }, [])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('customer_accounts.admin.filters.status', 'Status'),
      type: 'select',
      options: [
        { value: 'active', label: t('customer_accounts.admin.filters.active', 'Active') },
        { value: 'inactive', label: t('customer_accounts.admin.filters.inactive', 'Inactive') },
      ],
    },
    {
      id: 'roleId',
      label: t('customer_accounts.admin.filters.role', 'Role'),
      type: 'select',
      options: roleOptions,
    },
  ], [roleOptions, t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    const status = filterValues.status
    if (typeof status === 'string' && status.trim()) params.set('status', status)
    const roleId = filterValues.roleId
    if (typeof roleId === 'string' && roleId.trim()) params.set('roleId', roleId)
    return params.toString()
  }, [filterValues, page, pageSize, search])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: UsersResponse = { items: [], total: 0, totalPages: 1 }
        const payload = await readApiResultOrThrow<UsersResponse>(
          `/api/customer_accounts/admin/users?${queryParams}`,
          undefined,
          { errorMessage: t('customer_accounts.admin.error.loadUsers', 'Failed to load customer users'), fallback },
        )
        if (cancelled) return
        const items = Array.isArray(payload?.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload?.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload?.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.loadUsers', 'Failed to load customer users')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, t])

  const handleToggleActive = React.useCallback(async (user: UserRow) => {
    const nextActive = !user.isActive
    const actionLabel = nextActive
      ? t('customer_accounts.admin.actions.activate', 'Activate')
      : t('customer_accounts.admin.actions.deactivate', 'Deactivate')
    const confirmed = await confirm({
      title: t('customer_accounts.admin.confirm.toggleActive', '{{action}} user "{{name}}"?', {
        action: actionLabel,
        name: user.displayName || user.email,
      }),
      variant: nextActive ? 'default' : 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall(
        `/api/customer_accounts/admin/users/${encodeURIComponent(user.id)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isActive: nextActive }),
        },
      )
      if (!call.ok) {
        flash(t('customer_accounts.admin.error.toggleActive', 'Failed to update user status'), 'error')
        return
      }
      flash(
        nextActive
          ? t('customer_accounts.admin.flash.activated', 'User activated')
          : t('customer_accounts.admin.flash.deactivated', 'User deactivated'),
        'success',
      )
      setReloadToken((token) => token + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.toggleActive', 'Failed to update user status')
      flash(message, 'error')
    }
  }, [confirm, t])

  const handleDelete = React.useCallback(async (user: UserRow) => {
    const confirmed = await confirm({
      title: t('customer_accounts.admin.confirm.delete', 'Delete user "{{name}}"?', {
        name: user.displayName || user.email,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall(
        `/api/customer_accounts/admin/users/${encodeURIComponent(user.id)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        flash(t('customer_accounts.admin.error.delete', 'Failed to delete user'), 'error')
        return
      }
      flash(t('customer_accounts.admin.flash.deleted', 'User deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.delete', 'Failed to delete user')
      flash(message, 'error')
    }
  }, [confirm, t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const columns = React.useMemo<ColumnDef<UserRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">-</span>
    return [
      {
        accessorKey: 'displayName',
        header: t('customer_accounts.admin.columns.displayName', 'Name'),
        cell: ({ row }) => (
          <Link
            href={`/backend/customer_accounts/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.displayName || row.original.email}
          </Link>
        ),
      },
      {
        accessorKey: 'email',
        header: t('customer_accounts.admin.columns.email', 'Email'),
      },
      {
        accessorKey: 'emailVerified',
        header: t('customer_accounts.admin.columns.emailVerified', 'Verified'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            row.original.emailVerified
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
          }`}>
            {row.original.emailVerified
              ? t('customer_accounts.admin.verified', 'Yes')
              : t('customer_accounts.admin.unverified', 'No')}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('customer_accounts.admin.columns.status', 'Status'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            row.original.isActive
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}>
            {row.original.isActive
              ? t('customer_accounts.admin.active', 'Active')
              : t('customer_accounts.admin.inactive', 'Inactive')}
          </span>
        ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: t('customer_accounts.admin.columns.lastLogin', 'Last Login'),
        cell: ({ row }) => formatDate(row.original.lastLoginAt, '-') || noValue,
      },
      {
        accessorKey: 'roles',
        header: t('customer_accounts.admin.columns.roles', 'Roles'),
        cell: ({ row }) => {
          const roles = row.original.roles
          if (!roles || !roles.length) return noValue
          return <span className="text-sm">{roles.map((r) => r.name).join(', ')}</span>
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('customer_accounts.admin.columns.createdAt', 'Created'),
        cell: ({ row }) => formatDate(row.original.createdAt, '-'),
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<UserRow>
          title={t('customer_accounts.admin.title', 'Customer Accounts')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('customer_accounts.admin.searchPlaceholder', 'Search by name or email...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{ tableId: 'customer_accounts.admin.users' }}
          onRowClick={(row) => router.push(`/backend/customer_accounts/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('customer_accounts.admin.actions.view', 'View'),
                  onSelect: () => { router.push(`/backend/customer_accounts/${row.id}`) },
                },
                {
                  id: 'toggle-active',
                  label: row.isActive
                    ? t('customer_accounts.admin.actions.deactivate', 'Deactivate')
                    : t('customer_accounts.admin.actions.activate', 'Activate'),
                  onSelect: () => { void handleToggleActive(row) },
                },
                {
                  id: 'delete',
                  label: t('customer_accounts.admin.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => { void handleDelete(row) },
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
