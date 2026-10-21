"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

type LeadRow = {
  id: string
  displayName: string | null
  pipelineId: string | null
  stageId: string | null
  outcome: string | null
  source: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  ownerUserId: string | null
  convertedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

type Pipeline = { id: string; name: string; isDefault: boolean; isActive: boolean }
type Stage = { id: string; pipelineId: string; name: string; position: number; kind: string; isActive: boolean }

type LeadsResponse = {
  items?: LeadRow[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 25

function outcomeVariant(outcome: string | null | undefined): 'neutral' | 'success' | 'error' | 'warning' {
  if (outcome === 'won') return 'success'
  if (outcome === 'lost') return 'error'
  return 'neutral'
}

export default function LeadsPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<LeadRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)
  const [search, setSearch] = React.useState('')
  const [pipelineId, setPipelineId] = React.useState<string>('')
  const [stageId, setStageId] = React.useState<string>('')
  const [outcome, setOutcome] = React.useState<string>('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([])
  const [stages, setStages] = React.useState<Stage[]>([])
  const [reloadToken, setReloadToken] = React.useState(0)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-leads-list',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      apiCall<{ items?: Pipeline[] }>('/api/customers/lead-pipelines'),
      apiCall<{ items?: Stage[] }>('/api/customers/lead-pipeline-stages'),
    ])
      .then(([pipelineCall, stageCall]) => {
        if (cancelled) return
        setPipelines(Array.isArray(pipelineCall.result?.items) ? pipelineCall.result.items : [])
        setStages(Array.isArray(stageCall.result?.items) ? stageCall.result.items : [])
      })
      .catch((err) => logger.warn('Lead configuration load failed', { err }))
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (search.trim()) params.set('search', search.trim())
    if (pipelineId) params.set('pipelineId', pipelineId)
    if (stageId) params.set('stageId', stageId)
    if (outcome) params.set('outcome', outcome)
    apiCall<LeadsResponse>(`/api/customers/leads?${params.toString()}`)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          const items = Array.isArray(response.result.items) ? response.result.items : []
          setRows(items)
          setTotal(typeof response.result.total === 'number' ? response.result.total : items.length)
          return
        }
        flash(t('customers.leads.list.loadError', 'Failed to load leads.'), 'error')
      })
      .catch((err) => {
        logger.warn('Leads list load failed', { err })
        if (!cancelled) flash(t('customers.leads.list.loadError', 'Failed to load leads.'), 'error')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, pageSize, search, pipelineId, stageId, outcome, reloadToken, t])

  const pipelineNames = React.useMemo(
    () => new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.name])),
    [pipelines],
  )
  const stageNames = React.useMemo(
    () => new Map(stages.map((stage) => [stage.id, stage])),
    [stages],
  )
  const stageOptions = React.useMemo(
    () => stages.filter((stage) => !pipelineId || stage.pipelineId === pipelineId),
    [stages, pipelineId],
  )

  const handleDelete = React.useCallback(async (row: LeadRow) => {
    setPendingDeleteId(row.id)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => apiCallOrThrow(`/api/customers/leads?id=${encodeURIComponent(row.id)}`, {
            method: 'DELETE',
          }),
        ),
        mutationPayload: { operation: 'leads.delete', id: row.id, updatedAt: row.updatedAt },
        context: {
          formId: 'customers-leads-list',
          resourceKind: 'customers.lead',
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(t('customers.leads.list.deleted', 'Lead deleted.'), 'success')
      setReloadToken((token) => token + 1)
    } catch {
      flash(t('customers.leads.list.deleteError', 'Failed to delete the lead.'), 'error')
    } finally {
      setPendingDeleteId(null)
    }
  }, [retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<LeadRow>[]>(() => [
    {
      id: 'displayName',
      header: t('customers.leads.list.columns.name', 'Name'),
      accessorFn: (row) => row.displayName ?? '',
      cell: ({ row }) => (
        <Link href={`/backend/customers/leads/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.displayName ?? t('customers.leads.list.unnamed', 'Unnamed lead')}
        </Link>
      ),
    },
    {
      id: 'stage',
      header: t('customers.leads.list.columns.stage', 'Stage'),
      cell: ({ row }) => {
        const stage = row.original.stageId ? stageNames.get(row.original.stageId) : null
        return stage?.name ?? t('customers.leads.list.noStage', '—')
      },
    },
    {
      id: 'outcome',
      header: t('customers.leads.list.columns.outcome', 'Outcome'),
      cell: ({ row }) => (
        <StatusBadge variant={outcomeVariant(row.original.outcome)} dot>
          {t(`customers.leads.outcome.${row.original.outcome ?? 'open'}`, row.original.outcome ?? 'open')}
        </StatusBadge>
      ),
    },
    {
      id: 'pipeline',
      header: t('customers.leads.list.columns.pipeline', 'Pipeline'),
      cell: ({ row }) => row.original.pipelineId ? pipelineNames.get(row.original.pipelineId) ?? '—' : '—',
    },
    {
      id: 'source',
      header: t('customers.leads.list.columns.source', 'Source'),
      accessorFn: (row) => row.source ?? '',
    },
    {
      id: 'primaryEmail',
      header: t('customers.leads.list.columns.email', 'Email'),
      accessorFn: (row) => row.primaryEmail ?? '',
    },
    {
      id: 'primaryPhone',
      header: t('customers.leads.list.columns.phone', 'Phone'),
      accessorFn: (row) => row.primaryPhone ?? '',
    },
    {
      id: 'updatedAt',
      header: t('customers.leads.list.columns.updated', 'Updated'),
      cell: ({ row }) => {
        const value = formatDateTime(row.original.updatedAt)
        return value ?? '—'
      },
    },
  ], [pipelineNames, stageNames, t])

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href="/backend/customers/leads/create">{t('customers.leads.list.new', 'New lead')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/backend/customers/leads/pipeline">{t('customers.leads.pipeline.title', 'Pipeline board')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/backend/config/customers/leads">{t('customers.leads.settings.title', 'Lead settings')}</Link>
          </Button>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Select
              value={pipelineId || '__all'}
              onValueChange={(next) => {
                setPipelineId(next === '__all' ? '' : next)
                setStageId('')
                setPage(1)
              }}
            >
              <SelectTrigger aria-label={t('customers.leads.list.filters.pipeline', 'Pipeline')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t('customers.leads.list.filters.allPipelines', 'All pipelines')}</SelectItem>
                {pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={stageId || '__all'}
              onValueChange={(next) => {
                setStageId(next === '__all' ? '' : next)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label={t('customers.leads.list.filters.stage', 'Stage')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t('customers.leads.list.filters.allStages', 'All stages')}</SelectItem>
                {stageOptions.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={outcome || '__all'}
              onValueChange={(next) => {
                setOutcome(next === '__all' ? '' : next)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label={t('customers.leads.list.filters.outcome', 'Outcome')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t('customers.leads.list.filters.allOutcomes', 'All outcomes')}</SelectItem>
                <SelectItem value="open">{t('customers.leads.outcome.open', 'Open')}</SelectItem>
                <SelectItem value="won">{t('customers.leads.outcome.won', 'Won')}</SelectItem>
                <SelectItem value="lost">{t('customers.leads.outcome.lost', 'Lost')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DataTable<LeadRow>
          title={t('customers.leads.list.title', 'Leads')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/customers/leads/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'open',
                  label: t('customers.leads.list.actions.open', 'Open'),
                  onSelect: () => router.push(`/backend/customers/leads/${row.id}`),
                },
                {
                  id: 'delete',
                  label: pendingDeleteId === row.id
                    ? t('customers.leads.list.actions.deleting', 'Deleting…')
                    : t('customers.leads.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => { void handleDelete(row) },
                },
              ]}
            />
          )}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('customers.leads.list.searchPlaceholder', 'Search leads…')}
          pagination={{
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            onPageChange: setPage,
            pageSizeOptions: [10, 25, 50, 100],
            onPageSizeChange: (next) => {
              setPageSize(next)
              setPage(1)
            },
          }}
          isLoading={isLoading}
          refreshButton={{
            label: t('customers.leads.list.refresh', 'Refresh'),
            onRefresh: () => setReloadToken((token) => token + 1),
          }}
        />
      </PageBody>
    </Page>
  )
}
