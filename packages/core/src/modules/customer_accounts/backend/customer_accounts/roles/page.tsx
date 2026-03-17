"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type RoleRow = {
  id: string
  name: string
  slug: string
  description: string | null
  isSystem: boolean
  isDefault: boolean
  customerAssignable: boolean
  createdAt: string
}

type RolesResponse = {
  items?: RoleRow[]
  total?: number
  totalPages?: number
}

export default function CustomerRolesPage() {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<RoleRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    return params.toString()
  }, [page, pageSize, search])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: RolesResponse = { items: [], total: 0, totalPages: 1 }
        const payload = await readApiResultOrThrow<RolesResponse>(
          `/api/customer_accounts/admin/roles?${queryParams}`,
          undefined,
          { errorMessage: t('customer_accounts.admin.roles.error.load', 'Failed to load roles'), fallback },
        )
        if (cancelled) return
        const items = Array.isArray(payload?.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload?.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload?.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('customer_accounts.admin.roles.error.load', 'Failed to load roles')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, t])

  const handleDelete = React.useCallback(async (role: RoleRow) => {
    if (role.isSystem) {
      flash(t('customer_accounts.admin.roles.error.deleteSystem', 'System roles cannot be deleted'), 'error')
      return
    }
    const confirmed = await confirm({
      title: t('customer_accounts.admin.roles.confirm.delete', 'Delete role "{{name}}"?', { name: role.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall(
        `/api/customer_accounts/admin/roles/${encodeURIComponent(role.id)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        flash(t('customer_accounts.admin.roles.error.delete', 'Failed to delete role'), 'error')
        return
      }
      flash(t('customer_accounts.admin.roles.flash.deleted', 'Role deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.roles.error.delete', 'Failed to delete role')
      flash(message, 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<RoleRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('customer_accounts.admin.roles.columns.name', 'Name'),
      cell: ({ row }) => (
        <Link
          href={`/backend/customer_accounts/roles/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'slug',
      header: t('customer_accounts.admin.roles.columns.slug', 'Slug'),
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.original.slug}</code>
      ),
    },
    {
      accessorKey: 'description',
      header: t('customer_accounts.admin.roles.columns.description', 'Description'),
      cell: ({ row }) => row.original.description || <span className="text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'isSystem',
      header: t('customer_accounts.admin.roles.columns.isSystem', 'System'),
      cell: ({ row }) => (
        row.original.isSystem ? (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {t('customer_accounts.admin.roles.system', 'System')}
          </span>
        ) : null
      ),
    },
    {
      accessorKey: 'isDefault',
      header: t('customer_accounts.admin.roles.columns.isDefault', 'Default'),
      cell: ({ row }) => (
        row.original.isDefault ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
            {t('customer_accounts.admin.roles.default', 'Default')}
          </span>
        ) : null
      ),
    },
    {
      accessorKey: 'customerAssignable',
      header: t('customer_accounts.admin.roles.columns.customerAssignable', 'Self-assignable'),
      cell: ({ row }) => (
        row.original.customerAssignable ? (
          <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900 dark:text-purple-200">
            {t('customer_accounts.admin.roles.assignable', 'Yes')}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">
            {t('customer_accounts.admin.roles.notAssignable', 'No')}
          </span>
        )
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<RoleRow>
          title={t('customer_accounts.admin.roles.title', 'Customer Roles')}
          actions={(
            <Button asChild>
              <Link href="/backend/customer_accounts/roles/create">
                {t('customer_accounts.admin.roles.actions.create', 'Create Role')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('customer_accounts.admin.roles.searchPlaceholder', 'Search roles...')}
          perspective={{ tableId: 'customer_accounts.admin.roles' }}
          onRowClick={(row) => router.push(`/backend/customer_accounts/roles/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('customer_accounts.admin.roles.actions.edit', 'Edit'),
                  onSelect: () => { router.push(`/backend/customer_accounts/roles/${row.id}`) },
                },
                ...(!row.isSystem ? [{
                  id: 'delete',
                  label: t('customer_accounts.admin.roles.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => { void handleDelete(row) },
                }] : []),
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
