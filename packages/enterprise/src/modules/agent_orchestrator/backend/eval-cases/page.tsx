"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type EvalCaseStatus = 'draft' | 'approved' | 'archived'
type EvalCaseSourceType = 'correction' | 'golden_run'
type StatusTab = 'all' | EvalCaseStatus

const STATUS_TABS: StatusTab[] = ['all', 'draft', 'approved', 'archived']

const STATUS_TONE: StatusMap<EvalCaseStatus> = {
  draft: 'info',
  approved: 'success',
  archived: 'neutral',
}

type EvalCaseRow = {
  id: string
  status: EvalCaseStatus
  sourceType: EvalCaseSourceType
  sourceId: string
  agentDefinitionId: string
  createdAt: string | null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapRow(item: Record<string, unknown>): EvalCaseRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const statusRaw = readString(item, 'status')
  const sourceTypeRaw = readString(item, 'source_type', 'sourceType')
  return {
    id,
    status: statusRaw === 'approved' ? 'approved' : statusRaw === 'archived' ? 'archived' : 'draft',
    sourceType: sourceTypeRaw === 'correction' ? 'correction' : 'golden_run',
    sourceId: readString(item, 'source_id', 'sourceId'),
    agentDefinitionId: readString(item, 'agent_definition_id', 'agentDefinitionId'),
    createdAt: readString(item, 'created_at', 'createdAt') || null,
  }
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  const trimmed = iso.slice(0, 16).replace('T', ' ')
  return trimmed.length >= 16 ? trimmed : iso
}

function initialTabFrom(param: string | null): StatusTab {
  return param === 'draft' || param === 'approved' || param === 'archived' ? param : 'all'
}

export default function EvalCasesPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const [tab, setTab] = React.useState<StatusTab>(() => initialTabFrom(searchParams?.get('status') ?? null))
  const [rows, setRows] = React.useState<EvalCaseRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (tab !== 'all') params.set('status', tab)
      const call = await apiCall<{ items?: Array<Record<string, unknown>>; total?: number }>(
        `/api/agent_orchestrator/eval-cases?${params.toString()}`,
        undefined,
        { fallback: { items: [], total: 0 } },
      )
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.evalCases.list.error'))
        setIsLoading(false)
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setRows(items.map(mapRow).filter((row): row is EvalCaseRow => !!row))
      setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t, tab, page, pageSize])

  const columns = React.useMemo<ColumnDef<EvalCaseRow>[]>(
    () => [
      {
        accessorKey: 'status',
        header: t('agent_orchestrator.evalCases.col.status'),
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_TONE[row.original.status]} dot>
            {t(`agent_orchestrator.evalCases.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'agentDefinitionId',
        header: t('agent_orchestrator.evalCases.col.agent'),
        cell: ({ row }) => <span className="font-mono text-sm text-foreground">{row.original.agentDefinitionId}</span>,
      },
      {
        accessorKey: 'sourceType',
        header: t('agent_orchestrator.evalCases.col.sourceType'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {t(
              row.original.sourceType === 'correction'
                ? 'agent_orchestrator.evalCases.sourceType.correction'
                : 'agent_orchestrator.evalCases.sourceType.goldenRun',
            )}
          </span>
        ),
      },
      {
        accessorKey: 'sourceId',
        header: t('agent_orchestrator.evalCases.col.sourceId'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground" title={row.original.sourceId}>
            {row.original.sourceId.slice(0, 12)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('agent_orchestrator.evalCases.col.created'),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDateTime(row.original.createdAt) ?? '—'}
          </span>
        ),
      },
    ],
    [t],
  )

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.evalCases.list.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalCases.list.subtitle')}</p>
        </div>

        <div className="flex flex-nowrap items-center gap-4 overflow-x-auto border-b border-border">
          {STATUS_TABS.map((statusTab) => {
            const active = tab === statusTab
            return (
              <button
                key={statusTab}
                type="button"
                onClick={() => {
                  setTab(statusTab)
                  setPage(1)
                }}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-brand-violet font-semibold text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(
                  statusTab === 'all'
                    ? 'agent_orchestrator.evalCases.tab.all'
                    : `agent_orchestrator.evalCases.status.${statusTab}`,
                )}
              </button>
            )
          })}
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.evalCases.list.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.evalCases.empty.title')}
            description={t('agent_orchestrator.evalCases.empty.description')}
          />
        ) : (
          <DataTable<EvalCaseRow>
            columns={columns}
            data={rows}
            pagination={{
              page,
              pageSize,
              total,
              totalPages,
              onPageChange: setPage,
              pageSizeOptions: [20, 50, 100],
              onPageSizeChange: (next) => {
                setPageSize(next)
                setPage(1)
              },
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
