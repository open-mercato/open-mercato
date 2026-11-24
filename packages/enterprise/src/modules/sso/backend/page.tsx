'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceSsoAdminError } from '../components/surfaceSsoAdminError'
import Link from 'next/link'

interface SsoConfigRow {
  id: string
  name: string | null
  protocol: string
  issuer: string | null
  allowedDomains: string[]
  isActive: boolean
  hasClientSecret: boolean
  organizationId: string
  tenantId: string | null
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  items: SsoConfigRow[]
  total: number
  totalPages: number
  totalIsCapped?: boolean
  isSuperAdmin?: boolean
}

const fallback: ListResponse = { items: [], total: 0, totalPages: 1 }

export default function SsoConfigListPage() {
  const router = useRouter()
  const t = useT()

  const [data, setData] = React.useState<ListResponse>(fallback)
  const [isLoading, setIsLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'sso-config-list',
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

  const isSuperAdmin = !!data.isSuperAdmin

  const fetchData = React.useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', '50')
    if (search) params.set('search', search)

    const call = await apiCall<ListResponse>(`/api/sso/config?${params}`, undefined, { fallback })
    if (call.ok && call.result) {
      setData(call.result)
    }
    setIsLoading(false)
  }, [page, search])

  React.useEffect(() => { fetchData() }, [fetchData])

  const handleDelete = async (row: SsoConfigRow) => {
    if (row.isActive) {
      flash(t('sso.admin.error.deleteActive', 'Cannot delete an active SSO configuration — deactivate it first'), 'error')
      return
    }

    const confirmed = await confirm({
      title: t('sso.admin.delete.title', 'Delete SSO Configuration'),
      text: t('sso.admin.delete.confirm', 'Are you sure? This will remove the SSO configuration. Users with linked SSO identities will need to use password login.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })

    if (!confirmed) return

    try {
      await runMutationWithContext(
        () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          apiCallOrThrow(`/api/sso/config/${row.id}`, { method: 'DELETE' }, {
            errorMessage: t('sso.admin.error.deleteFailed', 'Failed to delete SSO configuration'),
          }),
        ),
        { id: row.id },
      )
    } catch (err) {
      surfaceSsoAdminError(err, t, t('sso.admin.error.deleteFailed', 'Failed to delete SSO configuration'), { onRefresh: fetchData })
      return
    }
    flash(t('sso.admin.delete.success', 'SSO configuration deleted'), 'success')
    fetchData()
  }

  const handleToggleActivation = async (row: SsoConfigRow) => {
    try {
      await runMutationWithContext(
        () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          apiCallOrThrow(
            `/api/sso/config/${row.id}/activate`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ active: !row.isActive }),
            },
            { errorMessage: t('sso.admin.error.activationFailed', 'Failed to update activation status') },
          ),
        ),
        { id: row.id, active: !row.isActive },
      )
      flash(
        row.isActive
          ? t('sso.admin.deactivated', 'SSO configuration deactivated')
          : t('sso.admin.activated', 'SSO configuration activated'),
        'success',
      )
      fetchData()
    } catch (err) {
      surfaceSsoAdminError(err, t, t('sso.admin.error.activationFailed', 'Failed to update activation status'), { onRefresh: fetchData })
    }
  }

  const handleTestConnection = async (row: SsoConfigRow) => {
    try {
      const call = await runMutationWithContext(
        () => apiCallOrThrow<{ ok: boolean; error?: string }>(
          `/api/sso/config/${row.id}/test`,
          { method: 'POST' },
          { errorMessage: t('sso.admin.error.testFailed', 'Connection test failed') },
        ),
        { id: row.id },
      )
      if (call.result?.ok) {
        flash(t('sso.admin.test.success', 'Discovery successful — issuer is reachable'), 'success')
      } else {
        flash(call.result?.error || t('sso.admin.test.failed', 'Discovery failed'), 'error')
      }
    } catch (err) {
      surfaceSsoAdminError(err, t, t('sso.admin.error.testFailed', 'Connection test failed'))
    }
  }

  const columns = React.useMemo<ColumnDef<SsoConfigRow>[]>(() => {
    const cols: ColumnDef<SsoConfigRow>[] = [
      {
        accessorKey: 'name',
        header: t('sso.admin.column.name', 'Name'),
        cell: ({ row }) => row.original.name || row.original.issuer || '—',
      },
      {
        accessorKey: 'protocol',
        header: t('sso.admin.column.protocol', 'Protocol'),
        cell: ({ row }) => row.original.protocol.toUpperCase(),
      },
      {
        accessorKey: 'allowedDomains',
        header: t('sso.admin.column.domains', 'Domains'),
        cell: ({ row }) => row.original.allowedDomains.join(', ') || '—',
      },
      {
        accessorKey: 'isActive',
        header: t('sso.admin.column.status', 'Status'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${row.original.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {row.original.isActive
              ? t('sso.admin.status.active', 'Active')
              : t('sso.admin.status.inactive', 'Inactive')}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('sso.admin.column.created', 'Created'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
      },
    ]

    return cols
  }, [t, isSuperAdmin])

  const hasConfigs = data.items.length > 0 || search
  const canCreateNew = isSuperAdmin || data.items.length === 0

  return (
    <Page>
      <PageBody>
        {!hasConfigs && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="text-lg font-semibold mb-2">
              {t('sso.admin.empty.title', 'No SSO configured')}
            </h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              {t('sso.admin.empty.description', 'Configure Single Sign-On to let your users authenticate with your identity provider.')}
            </p>
            <Button asChild>
              <Link href="/backend/sso/config/new">
                {t('sso.admin.empty.cta', 'Configure SSO')}
              </Link>
            </Button>
          </div>
        ) : (
          <DataTable<SsoConfigRow>
        title={t('sso.admin.title', 'Single Sign-On')}
        titleHeadingLevel={1}
            actions={canCreateNew ? (
              <Button asChild size="sm">
                <Link href="/backend/sso/config/new">
                  {t('sso.admin.new', 'New SSO Config')}
                </Link>
              </Button>
            ) : undefined}
            columns={columns}
            data={data.items}
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(1) }}
            searchPlaceholder={t('sso.admin.search', 'Search by name or issuer...')}
            onRowClick={(row) => router.push(`/backend/sso/config/${row.id}`)}
            rowActions={(row) => (
              <RowActions
                items={[
                  { id: 'edit', label: t('common.edit', 'Edit'), onSelect: () => router.push(`/backend/sso/config/${row.id}`) },
                  { id: 'test', label: t('sso.admin.action.test', 'Verify Discovery'), onSelect: () => handleTestConnection(row) },
                  {
                    id: 'toggle',
                    label: row.isActive
                      ? t('sso.admin.action.deactivate', 'Deactivate')
                      : t('sso.admin.action.activate', 'Activate'),
                    onSelect: () => handleToggleActivation(row),
                  },
                  { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
                ]}
              />
            )}
            pagination={{
              page,
              pageSize: 50,
              total: data.total,
              totalPages: data.totalPages,
              totalIsCapped: data?.totalIsCapped === true,
              onPageChange: setPage,
            }}
            isLoading={isLoading}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
