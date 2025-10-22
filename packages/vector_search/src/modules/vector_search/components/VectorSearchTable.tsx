"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@/lib/utils'

function StatusBadge({ variant = 'default', children }: { variant?: 'default' | 'destructive'; children: React.ReactNode }) {
  const className = cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
    variant === 'destructive' ? 'bg-destructive/15 text-destructive border border-destructive/30' : 'bg-muted text-muted-foreground border border-muted-foreground/20'
  )
  return <span className={className}>{children}</span>
}

export type VectorSearchRecordRow = {
  id: string
  entityType: string
  recordId: string
  moduleId: string
  title: string
  lead: string | null
  icon: string | null
  primaryUrl: string
  links: Array<{ href: string; label: string; relation?: string | null }> | null
  embeddingModel: string | null
  embeddingDimensions: number | null
  embeddingError: string | null
  lastIndexedAt: string | null
  updatedAt: string | null
}

export default function VectorSearchTable() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])

  const queryKey = React.useMemo(() => ['vector-search-records', page, pageSize, search], [page, pageSize, search])
  const t = useT()

  const { data, isLoading, refetch, isFetching } = useQuery<{ items: any[]; total: number; page: number; pageSize: number; embeddingReady: boolean }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (search.trim().length) params.set('query', search.trim())
      const res = await apiFetch(`/api/vector-search/records?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load vector search records')
      return res.json()
    },
    keepPreviousData: true,
  })

  const rows: VectorSearchRecordRow[] = React.useMemo(() => {
    return (data?.items || []).map((item) => ({
      id: item.id,
      entityType: item.entity_type,
      recordId: item.record_id,
      moduleId: item.module_id,
      title: item.title,
      lead: item.lead ?? null,
      icon: item.icon ?? null,
      primaryUrl: item.primary_url,
      links: item.links ?? null,
      embeddingModel: item.embedding_model ?? null,
      embeddingDimensions: typeof item.embedding_dimensions === 'number' ? item.embedding_dimensions : (item.embedding_dimensions ? Number(item.embedding_dimensions) : null),
      embeddingError: item.embedding_error ?? null,
      lastIndexedAt: item.last_indexed_at ?? null,
      updatedAt: item.updated_at ?? null,
    }))
  }, [data?.items])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const formatDate = (value: string | null) => {
    if (!value) return '—'
    try {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    } catch {
      return value
    }
  }

  const columns = React.useMemo<ColumnDef<VectorSearchRecordRow>[]>(() => [
    {
      id: 'title',
      header: 'Title',
      accessorKey: 'title',
      cell: ({ row }) => {
        const record = row.original
        return (
          <div className="flex flex-col">
            <span className="font-medium text-sm">{record.title}</span>
            {record.lead ? <span className="text-xs text-muted-foreground">{record.lead}</span> : null}
            <span className="text-xs text-muted-foreground">{record.entityType}</span>
          </div>
        )
      },
      meta: { priority: 1 },
    },
    {
      id: 'module',
      header: 'Module',
      accessorKey: 'moduleId',
      meta: { priority: 2 },
    },
    {
      id: 'embedding',
      header: 'Embedding',
      cell: ({ row }) => {
        const record = row.original
        if (record.embeddingError) {
          return <StatusBadge variant="destructive">Error</StatusBadge>
        }
        if (!record.embeddingModel) {
          return <span className="text-muted-foreground text-xs">Pending</span>
        }
        return (
          <span className="text-xs text-muted-foreground">
            {record.embeddingModel}
            {record.embeddingDimensions ? ` · ${record.embeddingDimensions}d` : ''}
          </span>
        )
      },
      meta: { priority: 3 },
    },
    {
      id: 'indexed',
      header: 'Indexed at',
      accessorFn: (row) => row.lastIndexedAt,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.lastIndexedAt)}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'updated',
      header: 'Updated',
      accessorFn: (row) => row.updatedAt,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.updatedAt)}</span>,
      meta: { priority: 2 },
    },
  ], [])

  return (
    <div className="flex flex-col gap-4">
      {!data?.embeddingReady ? (
        <div className="rounded border border-yellow-300 bg-yellow-50 text-yellow-900 px-4 py-3 text-sm">
          {t('vector_search.empty.configure', 'Set VECTOR_SEARCH_OPENAI_API_KEY to enable embeddings.')}
        </div>
      ) : null}
      <DataTable
        title={t('vector_search.table.title', 'Vector Search Records')}
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={(value) => { setSearch(value); setPage(1) }}
        sorting={sorting}
        onSortingChange={setSorting}
        sortable
        isLoading={isLoading}
        refreshButton={{ onRefresh: () => refetch(), label: 'Refresh', isRefreshing: isFetching }}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        rowActions={(row) => {
          const items = [
            { label: 'Open primary', onSelect: () => window.open(row.primaryUrl, '_blank', 'noopener,noreferrer') },
            ...(row.links || []).map((link) => ({
              label: link.label || link.href,
              onSelect: () => window.open(link.href, '_blank', 'noopener,noreferrer'),
            })),
          ]
          return <RowActions items={items} />
        }}
        onRowClick={(row) => {
          if (!row.primaryUrl) return
          window.open(row.primaryUrl, '_blank', 'noopener,noreferrer')
        }}
      />
    </div>
  )
}
