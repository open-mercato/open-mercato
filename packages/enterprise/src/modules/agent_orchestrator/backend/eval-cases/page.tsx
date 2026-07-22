"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { z } from 'zod'
import { Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../components/types'
import { agentLabelFor } from '../../components/useAgentLabels'

type EvalCaseStatus = 'draft' | 'approved' | 'archived'
type EvalCaseSourceType = 'correction' | 'golden_run'
type StatusTab = 'all' | EvalCaseStatus

const STATUS_TABS: StatusTab[] = ['all', 'draft', 'approved', 'archived']

const STATUS_TONE: StatusMap<EvalCaseStatus> = {
  draft: 'info',
  approved: 'success',
  archived: 'neutral',
}

const ENTITY_ID = 'agent_orchestrator:agent_eval_case'

type EvalCaseRow = {
  id: string
  status: EvalCaseStatus
  sourceType: EvalCaseSourceType
  sourceId: string
  agentDefinitionId: string
  createdAt: string | null
  // Carried per row so approve/archive can send the optimistic-lock header the
  // commands behind those endpoints enforce.
  updatedAt: string | null
}

type CaseFormValues = {
  agentDefinitionId: string
  processType?: string
  input: string
  expected?: string
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
    updatedAt: readString(item, 'updated_at', 'updatedAt') || null,
  }
}

function initialTabFrom(param: string | null): StatusTab {
  return param === 'draft' || param === 'approved' || param === 'archived' ? param : 'all'
}

export default function EvalCasesPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = React.useState<StatusTab>(() => initialTabFrom(searchParams?.get('status') ?? null))
  const [rows, setRows] = React.useState<EvalCaseRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'list' | 'create'>('list')
  const [agents, setAgents] = React.useState<CrudFieldOption[]>([])

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.evalCases',
    blockedMessage: t('agent_orchestrator.evalCases.flash.actionError'),
  })

  // Generation token: a tab switch or page change starts a new request while the
  // previous one is still in flight, and without this the SLOWER response wins and
  // populates the wrong tab. Also prevents setState after unmount.
  const loadGenerationRef = React.useRef(0)

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    const generation = ++loadGenerationRef.current
    if (!opts?.silent) setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (tab !== 'all') params.set('status', tab)
    const call = await apiCall<{ items?: Array<Record<string, unknown>>; total?: number }>(
      `/api/agent_orchestrator/eval-cases?${params.toString()}`,
      undefined,
      { fallback: { items: [], total: 0 } },
    )
    if (generation !== loadGenerationRef.current) return
    if (!call.ok) {
      setError(t('agent_orchestrator.evalCases.list.error'))
      setIsLoading(false)
      return
    }
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    setRows(items.map(mapRow).filter((row): row is EvalCaseRow => !!row))
    setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
    setIsLoading(false)
  }, [t, tab, page, pageSize])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAgents(
        items
          .map((item) => {
            const id = readString(item, 'id', 'agent_id')
            const label = readString(item, 'label') || id
            return { value: id, label }
          })
          .filter((option) => option.value !== ''),
      )
    })
    return () => { cancelled = true }
  }, [])

  // Derived from the registry this page already loads for the create form, so the
  // Agent column costs no extra round-trip.
  const agentLabels = React.useMemo(
    () => new Map(agents.map((option) => [option.value, option.label])),
    [agents],
  )

  const changeStatus = React.useCallback(async (row: EvalCaseRow, action: 'approve' | 'archive') => {
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCallOrThrow(
              `/api/agent_orchestrator/eval-cases/${encodeURIComponent(row.id)}/${action}`,
              { method: 'POST' },
            ),
          ),
        context: { retryLastMutation },
      })
      flash(
        t(
          action === 'approve'
            ? 'agent_orchestrator.evalCases.flash.approved'
            : 'agent_orchestrator.evalCases.flash.archived',
        ),
        'success',
      )
      await load({ silent: true })
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(t('agent_orchestrator.evalCases.flash.actionError'), 'error')
    }
  }, [runMutation, retryLastMutation, load, t])

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
        // The registry label, falling back to the id for an agent the registry no
        // longer knows. The id stays reachable as the title so a case can still be
        // matched to a definition by key.
        cell: ({ row }) => (
          <span className="truncate text-sm text-foreground" title={row.original.agentDefinitionId}>
            {agentLabelFor(agentLabels, row.original.agentDefinitionId)}
          </span>
        ),
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
            {formatDateTime(row.original.createdAt, locale) ?? '—'}
          </span>
        ),
      },
    ],
    [t, locale, agentLabels],
  )

  const formSchema = React.useMemo(
    () =>
      z.object({
        agentDefinitionId: z.string().min(1, 'agent_orchestrator.evalCases.form.errors.agentRequired'),
        processType: z.string().optional(),
        input: z.string().min(1, 'agent_orchestrator.evalCases.form.errors.inputRequired'),
        expected: z.string().optional(),
      }),
    [],
  )

  const agentOptions = React.useMemo<CrudFieldOption[]>(() => agents, [agents])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'agentDefinitionId',
        label: t('agent_orchestrator.evalCases.form.agent'),
        type: 'combobox',
        options: agentOptions,
        seedOptions: agentOptions,
        allowCustomValues: true,
        required: true,
      },
      {
        id: 'processType',
        label: t('agent_orchestrator.evalCases.form.processType'),
        type: 'text',
        description: t('agent_orchestrator.evalCases.form.processTypeHint'),
      },
      {
        id: 'input',
        label: t('agent_orchestrator.evalCases.form.input'),
        type: 'textarea',
        description: t('agent_orchestrator.evalCases.form.jsonHint'),
        required: true,
      },
      {
        id: 'expected',
        label: t('agent_orchestrator.evalCases.form.expected'),
        type: 'textarea',
        description: t('agent_orchestrator.evalCases.form.jsonHint'),
      },
    ],
    [t, agentOptions],
  )

  if (mode === 'create') {
    return (
      <Page>
        <PageBody>
          <div className="max-w-2xl">
            <CrudForm<CaseFormValues>
              title={t('agent_orchestrator.evalCases.form.createTitle')}
              fields={fields}
              initialValues={{ agentDefinitionId: '', input: '' }}
              entityIds={[ENTITY_ID]}
              schema={formSchema}
              submitLabel={t('agent_orchestrator.evalCases.form.submit')}
              cancelHref="/backend/eval-cases"
              onSubmit={async (values) => {
                // `input`/`expected` are free-form JSON payloads replayed through the
                // agent runtime, so they are authored as text and parsed here — a
                // malformed payload must fail on the field, not as a 400 from the API.
                let parsedInput: unknown
                try {
                  parsedInput = JSON.parse(values.input)
                } catch {
                  const message = t('agent_orchestrator.evalCases.form.errors.inputJson')
                  throw createCrudFormError(message, { input: message })
                }
                let parsedExpected: unknown
                const expectedRaw = values.expected?.trim() ?? ''
                if (expectedRaw) {
                  try {
                    parsedExpected = JSON.parse(expectedRaw)
                  } catch {
                    const message = t('agent_orchestrator.evalCases.form.errors.expectedJson')
                    throw createCrudFormError(message, { expected: message })
                  }
                }
                const processType = values.processType?.trim() ?? ''
                await createCrud('agent_orchestrator/eval-cases', {
                  agentDefinitionId: values.agentDefinitionId,
                  input: parsedInput,
                  expected: expectedRaw ? parsedExpected : undefined,
                  processType: processType || undefined,
                })
                flash(t('agent_orchestrator.evalCases.flash.created'), 'success')
                setMode('list')
                await load()
              }}
            />
          </div>
        </PageBody>
      </Page>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Page>
      <PageBody className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('agent_orchestrator.evalCases.list.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalCases.list.subtitle')}</p>
          </div>
          <Button type="button" size="sm" onClick={() => setMode('create')}>
            <Plus className="mr-2 size-4" />
            {t('agent_orchestrator.evalCases.actions.new')}
          </Button>
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
            onRowClick={(row) => router.push(`/backend/eval-cases/${encodeURIComponent(row.id)}`)}
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'open',
                    label: t('agent_orchestrator.evalCases.actions.open'),
                    onSelect: () => router.push(`/backend/eval-cases/${encodeURIComponent(row.id)}`),
                  },
                  // Approve only applies to a draft; archive is the exit for anything
                  // not already archived. Rendering them unconditionally would offer
                  // transitions the command layer rejects with 409.
                  ...(row.status === 'draft'
                    ? [{
                        id: 'approve',
                        label: t('agent_orchestrator.evalCases.actions.approve'),
                        onSelect: () => { void changeStatus(row, 'approve') },
                      }]
                    : []),
                  ...(row.status === 'draft' || row.status === 'approved'
                    ? [{
                        id: 'archive',
                        label: t('agent_orchestrator.evalCases.actions.archive'),
                        onSelect: () => { void changeStatus(row, 'archive') },
                      }]
                    : []),
                ]}
              />
            )}
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
