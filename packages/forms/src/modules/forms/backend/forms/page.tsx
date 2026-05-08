"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type FormStatus = 'draft' | 'active' | 'archived'

type FormRow = {
  id: string
  key: string
  name: string
  description: string | null
  status: FormStatus
  defaultLocale: string
  supportedLocales: string[]
  currentPublishedVersionId: string | null
  currentPublishedVersionNumber: number | null
  draftVersionId: string | null
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  items: FormRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const statusVariantMap: Record<FormStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  draft: 'warning',
  archived: 'neutral',
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

export default function FormsListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<FormRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('forms.list.filters.status'),
      type: 'select',
      options: [
        { value: 'draft', label: t('forms.list.filters.statusDraft') },
        { value: 'active', label: t('forms.list.filters.statusActive') },
        { value: 'archived', label: t('forms.list.filters.statusArchived') },
      ],
      multi: true,
    },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '20')
      if (search.trim()) params.set('q', search.trim())
      const statusValue = filterValues.status
      if (Array.isArray(statusValue) && statusValue.length > 0) {
        params.set('status', statusValue.join(','))
      } else if (typeof statusValue === 'string' && statusValue) {
        params.set('status', statusValue)
      }
      const fallback: ListResponse = { items: [], total: 0, page, pageSize: 20, totalPages: 1 }
      try {
        const call = await apiCall<ListResponse>(
          `/api/forms?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const errPayload = call.result as { error?: string } | undefined
          flash(errPayload?.error ?? 'forms.errors.internal', 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(payload.items)
          setTotal(payload.total)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          flash(error instanceof Error ? error.message : 'forms.errors.internal', 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [page, search, filterValues, reloadToken, scopeVersion])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const handleArchive = React.useCallback(async (row: FormRow) => {
    const ok = await confirm({
      title: t('forms.list.actions.archive'),
      variant: 'destructive',
    })
    if (!ok) return
    const call = await apiCall(`/api/forms/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
    if (!call.ok) {
      const errPayload = call.result as { error?: string } | undefined
      flash(errPayload?.error ?? 'forms.errors.internal', 'error')
      return
    }
    flash('forms.list.actions.archive', 'success')
    reload()
  }, [confirm, reload, t])

  const columns = React.useMemo<ColumnDef<FormRow>[]>(() => [
    {
      header: t('forms.list.columns.name'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <Link
          href={`/backend/forms/${encodeURIComponent(row.original.id)}`}
          className="font-medium text-foreground hover:underline"
        >
          {row.original.name}
        </Link>
      ),
      meta: { truncate: true, maxWidth: 320 },
    },
    {
      header: t('forms.list.columns.key'),
      accessorKey: 'key',
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">{row.original.key}</span>
      ),
    },
    {
      header: t('forms.list.columns.status'),
      accessorKey: 'status',
      cell: ({ row }) => {
        const status = row.original.status
        const labelKey = `forms.list.filters.status${status.charAt(0).toUpperCase()}${status.slice(1)}`
        return (
          <Tag variant={statusVariantMap[status]} dot>
            {t(labelKey)}
          </Tag>
        )
      },
    },
    {
      header: t('forms.list.columns.publishedVersion'),
      accessorKey: 'currentPublishedVersionNumber',
      cell: ({ row }) => {
        const num = row.original.currentPublishedVersionNumber
        return num ? `v${num}` : '—'
      },
    },
    {
      header: t('forms.list.columns.updatedAt'),
      accessorKey: 'updatedAt',
      cell: ({ row }) => formatDate(row.original.updatedAt),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const items = [
          {
            id: 'edit',
            label: t('forms.list.actions.edit'),
            onSelect: () => router.push(`/backend/forms/${encodeURIComponent(row.original.id)}`),
          },
          {
            id: 'history',
            label: t('forms.list.actions.history'),
            onSelect: () => router.push(`/backend/forms/${encodeURIComponent(row.original.id)}/history`),
          },
        ]
        if (row.original.status !== 'archived') {
          items.push({
            id: 'archive',
            label: t('forms.list.actions.archive'),
            destructive: true,
            onSelect: () => handleArchive(row.original),
          } as never)
        }
        return <RowActions items={items} />
      },
    },
  ], [t, router, handleArchive])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('forms.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/forms/create">{t('forms.list.actions.create')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('forms.list.search.placeholder')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={setFilterValues}
          onFiltersClear={() => setFilterValues({})}
          pagination={{
            page,
            pageSize: 20,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          emptyState={t('forms.list.empty')}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
