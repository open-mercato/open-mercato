"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type CredentialRow = {
  id: string
  credentialUrl: string
  credentialType: string
  title: string | null
  issuer: string | null
  badgeImageUrl: string | null
  verificationStatus: string
  instructorId: string
  createdAt: string | null
}

type CredentialsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function mapCredentialItem(item: Record<string, unknown>): CredentialRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    credentialUrl: (item.credential_url ?? '') as string,
    credentialType: (item.credential_type ?? 'other') as string,
    title: typeof item.title === 'string' ? item.title : null,
    issuer: typeof item.issuer === 'string' ? item.issuer : null,
    badgeImageUrl: typeof item.badge_image_url === 'string' ? item.badge_image_url : null,
    verificationStatus: (item.verification_status ?? 'pending') as string,
    instructorId: (item.instructor_id ?? '') as string,
    createdAt: typeof item.created_at === 'string' ? item.created_at : null,
  }
}

export default function CredentialsPage() {
  const [rows, setRows] = React.useState<CredentialRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'verificationStatus',
      label: t('instructors.credentials.list.filters.status', 'Status'),
      type: 'select',
      options: [
        { value: 'pending', label: t('instructors.credentials.status.pending', 'Pending') },
        { value: 'verified', label: t('instructors.credentials.status.verified', 'Verified') },
        { value: 'failed', label: t('instructors.credentials.status.failed', 'Failed') },
        { value: 'expired', label: t('instructors.credentials.status.expired', 'Expired') },
      ],
    },
    {
      id: 'credentialType',
      label: t('instructors.credentials.list.filters.type', 'Type'),
      type: 'select',
      options: [
        { value: 'unreal_engine', label: 'Unreal Engine' },
        { value: 'credly', label: 'Credly' },
        { value: 'other', label: t('instructors.credentials.type.other', 'Other') },
      ],
    },
  ], [t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const status = filterValues.verificationStatus
    if (typeof status === 'string' && status.trim()) params.set('verificationStatus', status)
    const credType = filterValues.credentialType
    if (typeof credType === 'string' && credType.trim()) params.set('credentialType', credType)
    return params.toString()
  }, [filterValues, page, pageSize])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: CredentialsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<CredentialsResponse>(`/api/credentials?${queryParams}`, undefined, { fallback })
        if (cancelled) return
        if (call.ok) {
          const payload = call.result ?? fallback
          const items = Array.isArray(payload.items) ? payload.items : []
          setRows(items.map((item) => mapCredentialItem(item as Record<string, unknown>)).filter((row): row is CredentialRow => !!row))
          setTotal(typeof payload.total === 'number' ? payload.total : items.length)
          setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
        }
      } catch (err) {
        if (!cancelled) {
          flash(err instanceof Error ? err.message : t('instructors.credentials.list.loadError', 'Failed to load credentials.'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleVerify = React.useCallback(async (credentialId: string) => {
    try {
      await apiCallOrThrow(
        '/api/credentials/verify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ credentialId }),
        },
        { errorMessage: t('instructors.credentials.verifyError', 'Verification failed.') },
      )
      flash(t('instructors.credentials.verifySuccess', 'Credential re-verified.'), 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      flash(err instanceof Error ? err.message : t('instructors.credentials.verifyError', 'Verification failed.'), 'error')
    }
  }, [t])

  const handleDelete = React.useCallback(async (credentialId: string) => {
    const confirmed = window.confirm(t('instructors.credentials.deleteConfirm', 'Delete this credential?'))
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/credentials?id=${encodeURIComponent(credentialId)}`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' } },
        { errorMessage: t('instructors.credentials.deleteError', 'Failed to delete credential.') },
      )
      flash(t('instructors.credentials.deleteSuccess', 'Credential deleted.'), 'success')
      setRows((prev) => prev.filter((row) => row.id !== credentialId))
      setTotal((prev) => Math.max(prev - 1, 0))
    } catch (err) {
      flash(err instanceof Error ? err.message : t('instructors.credentials.deleteError', 'Failed to delete credential.'), 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<CredentialRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">—</span>
    const statusColors: Record<string, string> = {
      verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      expired: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    }
    return [
      {
        accessorKey: 'title',
        header: t('instructors.credentials.list.columns.title', 'Title'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.badgeImageUrl && (
              <img src={row.original.badgeImageUrl} alt="" className="h-8 w-8 rounded object-contain" />
            )}
            <span className="font-medium text-sm">{row.original.title || t('instructors.credentials.untitled', 'Untitled')}</span>
          </div>
        ),
      },
      {
        accessorKey: 'issuer',
        header: t('instructors.credentials.list.columns.issuer', 'Issuer'),
        cell: ({ row }) => row.original.issuer || noValue,
      },
      {
        accessorKey: 'credentialType',
        header: t('instructors.credentials.list.columns.type', 'Type'),
        cell: ({ row }) => (
          <span className="text-sm capitalize">{row.original.credentialType.replace('_', ' ')}</span>
        ),
      },
      {
        accessorKey: 'verificationStatus',
        header: t('instructors.credentials.list.columns.status', 'Status'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[row.original.verificationStatus] ?? statusColors.pending}`}>
            {row.original.verificationStatus}
          </span>
        ),
      },
      {
        accessorKey: 'credentialUrl',
        header: t('instructors.credentials.list.columns.url', 'URL'),
        cell: ({ row }) => (
          <a href={row.original.credentialUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate max-w-[200px] inline-block">
            {row.original.credentialUrl}
          </a>
        ),
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<CredentialRow>
          title={t('instructors.credentials.list.title', 'All Credentials')}
          refreshButton={{
            label: t('instructors.credentials.list.actions.refresh', 'Refresh'),
            onRefresh: () => { setReloadToken((token) => token + 1) },
          }}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          perspective={{ tableId: 'instructors.credentials.list' }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('instructors.credentials.list.actions.verify', 'Re-verify'),
                  onSelect: () => handleVerify(row.id),
                },
                {
                  label: t('instructors.credentials.list.actions.viewExternal', 'View External'),
                  onSelect: () => window.open(row.credentialUrl, '_blank', 'noopener'),
                },
                {
                  label: t('instructors.credentials.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row.id),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
