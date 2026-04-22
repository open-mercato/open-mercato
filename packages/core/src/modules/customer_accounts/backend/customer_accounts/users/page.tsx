"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe, Settings } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
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

async function fetchRoleFilterOptions(): Promise<Array<{ value: string; label: string; id: string }>> {
  try {
    const call = await apiCall<{ items?: Array<{ id: string; name: string }> }>(
      '/api/customer_accounts/admin/roles?pageSize=100',
    )
    if (!call.ok) return []
    const items = Array.isArray(call.result?.items) ? call.result!.items : []
    return items
      .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string')
      .map((item) => ({ value: item.id, label: item.name, id: item.id }))
  } catch {
    return []
  }
}

function CreateUserDialog({
  open,
  onOpenChange,
  roleOptions,
  onCreated,
  onRunMutation,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  roleOptions: Array<{ id: string; label: string }>
  onCreated: () => void
  onRunMutation: <T>(operation: () => Promise<T>) => Promise<T>
}) {
  const t = useT()
  const [email, setEmail] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const resetForm = React.useCallback(() => {
    setEmail('')
    setDisplayName('')
    setPassword('')
    setSelectedRoleIds([])
  }, [])

  const handleSubmit = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !displayName.trim() || !password.trim()) {
      flash(t('customer_accounts.admin.createUser.error.required', 'Email, name, and password are required'), 'error')
      return
    }
    setIsSubmitting(true)
    try {
      await onRunMutation(async () => {
        const call = await apiCall<{ ok: boolean; error?: string }>(
          '/api/customer_accounts/admin/users',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email: email.trim(),
              displayName: displayName.trim(),
              password,
              roleIds: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
            }),
          },
        )
        if (!call.ok) {
          flash(call.result?.error || t('customer_accounts.admin.createUser.error.save', 'Failed to create user'), 'error')
          return
        }
        flash(t('customer_accounts.admin.createUser.flash.created', 'User created'), 'success')
        resetForm()
        onOpenChange(false)
        onCreated()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.createUser.error.save', 'Failed to create user')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [displayName, email, onCreated, onOpenChange, onRunMutation, password, resetForm, selectedRoleIds, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      const form = (event.target as HTMLElement).closest('form')
      if (form) form.requestSubmit()
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('customer_accounts.admin.createUser.title', 'Create Customer User')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => { void handleSubmit(event) }} onKeyDown={handleKeyDown} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-email">
              {t('customer_accounts.admin.createUser.fields.email', 'Email')}
            </label>
            <input
              id="create-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t('customer_accounts.admin.createUser.fields.emailPlaceholder', 'user@example.com')}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-name">
              {t('customer_accounts.admin.createUser.fields.displayName', 'Display Name')}
            </label>
            <input
              id="create-name"
              type="text"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t('customer_accounts.admin.createUser.fields.displayNamePlaceholder', 'John Doe')}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-password">
              {t('customer_accounts.admin.createUser.fields.password', 'Password')}
            </label>
            <input
              id="create-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t('customer_accounts.admin.createUser.fields.passwordPlaceholder', 'Min. 8 characters')}
            />
          </div>
          {roleOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('customer_accounts.admin.createUser.fields.roles', 'Roles')}</p>
              <div className="flex flex-wrap gap-2">
                {roleOptions.map((role) => {
                  const isSelected = selectedRoleIds.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRoleIds((prev) =>
                        prev.includes(role.id) ? prev.filter((rid) => rid !== role.id) : [...prev, role.id],
                      )}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {role.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onOpenChange(false) }}>
              {t('customer_accounts.admin.createUser.actions.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('customer_accounts.admin.createUser.actions.creating', 'Creating...')
                : t('customer_accounts.admin.createUser.actions.create', 'Create User')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
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
  const [roleOptions, setRoleOptions] = React.useState<Array<{ value: string; label: string; id: string }>>([])
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    entityType: string
    entityId?: string
  }>({
    contextId: 'customer_accounts:users-list',
  })

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { entityType: 'customer_accounts:user' },
      })
    },
    [runMutation],
  )

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
      await runMutationWithContext(async () => {
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
      }, { userId: user.id, isActive: nextActive })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.toggleActive', 'Failed to update user status')
      flash(message, 'error')
    }
  }, [confirm, runMutationWithContext, t])

  const handleDelete = React.useCallback(async (user: UserRow) => {
    const confirmed = await confirm({
      title: t('customer_accounts.admin.confirm.delete', 'Delete user "{{name}}"?', {
        name: user.displayName || user.email,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutationWithContext(async () => {
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
      }, { id: user.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.delete', 'Failed to delete user')
      flash(message, 'error')
    }
  }, [confirm, runMutationWithContext, t])

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
            href={`/backend/customer_accounts/users/${row.original.id}`}
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
      <PageBody className="space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-950/50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {t('customer_accounts.admin.portalInfo.title', 'Customer Portal')}
              </h3>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                {t('customer_accounts.admin.portalInfo.description', 'Manage customer portal accounts. Customers can self-register, log in, and access orders, quotes, and invoices through the portal.')}
              </p>
              <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-400">
                {t('customer_accounts.admin.portalInfo.url', 'Portal URL: {url}', {
                  url: `${typeof window !== 'undefined' ? window.location.origin : ''}/[org-slug]/portal`,
                })}
              </p>
              <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">
                {t('customer_accounts.admin.portalInfo.credentials', 'Demo credentials: alice.johnson@example.com / password123')}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                asChild
              >
                <Link href="/backend/customer_accounts/settings">
                  <Settings className="size-4" />
                  {t('customer_accounts.admin.portalInfo.openConfiguration', 'Open Configuration')}
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                asChild
              >
                <a href={`${typeof window !== 'undefined' ? window.location.origin : ''}/portal`} target="_blank" rel="noopener noreferrer">
                  <Globe className="size-4" />
                  {t('customer_accounts.admin.portalInfo.open', 'Open Portal')}
                </a>
              </Button>
            </div>
          </div>
        </div>
        <DataTable<UserRow>
          title={t('customer_accounts.admin.title', 'Users')}
          actions={(
            <Button onClick={() => setCreateDialogOpen(true)}>
              {t('customer_accounts.admin.actions.createUser', 'Create User')}
            </Button>
          )}
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
          onRowClick={(row) => router.push(`/backend/customer_accounts/users/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('customer_accounts.admin.actions.view', 'View'),
                  onSelect: () => { router.push(`/backend/customer_accounts/users/${row.id}`) },
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
        <CreateUserDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          roleOptions={roleOptions}
          onCreated={() => setReloadToken((token) => token + 1)}
          onRunMutation={runMutationWithContext}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
