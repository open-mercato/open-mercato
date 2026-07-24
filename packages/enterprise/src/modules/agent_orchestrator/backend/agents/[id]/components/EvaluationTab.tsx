"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Binary, LockKeyhole, Plus, Play, Sparkles } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@open-mercato/ui/primitives/accordion'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../../components/types'
import { useCoalescedReload } from '../../../../components/useCoalescedReload'
import {
  evalSuiteOutcomeVariant,
  evalSuiteStatusVariant,
  formatPassScore,
  mapEvalRunRow,
  type EvalRunRow,
} from '../../../../components/evalRunTypes'
import { AssertionFormDrawer } from './AssertionFormDrawer'
import { EvalCaseDrawer } from './EvalCaseDrawer'
import { RunEvaluationDrawer } from './RunEvaluationDrawer'
import { EvalResultsDrawer } from './EvalResultsDrawer'

type EvaluationSection = 'assertions' | 'cases' | 'runs'

export type EvaluationTabProps = {
  agentId: string
  agentLabel: string
  active: boolean
  initialSection?: EvaluationSection
}

/** Shared with `AssertionFormDrawer` (type-only, erased at compile time). */
export type AssertionRow = {
  id: string
  key: string
  scorerKey: string
  title: string
  description: string | null
  appliesTo: string
  type: 'deterministic' | 'llm_judge'
  severity: 'gate' | 'warn'
  config: Record<string, unknown>
  enabled: boolean
  /** True when the row was inherited from a wildcard (`appliesTo = *`) query. */
  wildcard: boolean
  updatedAt: string | null
}

type EvalCaseStatus = 'draft' | 'approved' | 'archived'
type EvalCaseStatusFilter = 'all' | EvalCaseStatus

type EvalCaseRow = {
  id: string
  status: EvalCaseStatus
  processType: string | null
  createdAt: string | null
  updatedAt: string | null
}

const CASE_STATUS_FILTERS: EvalCaseStatusFilter[] = ['all', 'draft', 'approved', 'archived']

const severityVariant: StatusMap<'gate' | 'warn'> = { gate: 'error', warn: 'warning' }
const caseStatusTone: StatusMap<EvalCaseStatus> = { draft: 'info', approved: 'success', archived: 'neutral' }
const TYPE_ICON: Record<'deterministic' | 'llm_judge', React.ComponentType<{ className?: string }>> = {
  deterministic: Binary,
  llm_judge: Sparkles,
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapAssertion(item: Record<string, unknown>, wildcard: boolean): AssertionRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const type = readString(item, 'type') === 'llm_judge' ? 'llm_judge' : 'deterministic'
  const severity = readString(item, 'severity') === 'gate' ? 'gate' : 'warn'
  const config = (item.config && typeof item.config === 'object') ? (item.config as Record<string, unknown>) : {}
  const key = readString(item, 'key')
  const descriptionRaw = item.description
  const enabledRaw = item.enabled
  return {
    id,
    key,
    scorerKey:
      readString(item, 'scorer_key', 'scorerKey') ||
      (typeof config.scorer === 'string' ? config.scorer : '') ||
      key,
    config,
    title: readString(item, 'title'),
    description: typeof descriptionRaw === 'string' ? descriptionRaw : null,
    appliesTo: readString(item, 'applies_to', 'appliesTo') || '*',
    type,
    severity,
    enabled: enabledRaw === undefined ? true : Boolean(enabledRaw),
    wildcard,
    updatedAt: readString(item, 'updated_at', 'updatedAt') || null,
  }
}

function mapCase(item: Record<string, unknown>): EvalCaseRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const statusRaw = readString(item, 'status')
  return {
    id,
    status: statusRaw === 'approved' ? 'approved' : statusRaw === 'archived' ? 'archived' : 'draft',
    processType: readString(item, 'process_type', 'processType') || null,
    createdAt: readString(item, 'created_at', 'createdAt') || null,
    updatedAt: readString(item, 'updated_at', 'updatedAt') || null,
  }
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: 'default' | 'error' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tone === 'error' ? 'text-status-error-text' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

export default function EvaluationTab({ agentId, agentLabel, active, initialSection }: EvaluationTabProps) {
  const t = useT()
  const locale = useLocale()
  const [section, setSection] = React.useState<EvaluationSection>(initialSection ?? 'assertions')

  const [features, setFeatures] = React.useState<{ canManage: boolean; canRun: boolean } | null>(null)
  const [assertions, setAssertions] = React.useState<AssertionRow[]>([])
  const [cases, setCases] = React.useState<EvalCaseRow[]>([])
  const [runs, setRuns] = React.useState<EvalRunRow[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [forbidden, setForbidden] = React.useState(false)
  const [caseFilter, setCaseFilter] = React.useState<EvalCaseStatusFilter>('all')

  const [assertionDrawer, setAssertionDrawer] = React.useState<{ open: boolean; row: AssertionRow | null }>({ open: false, row: null })
  const [caseDrawer, setCaseDrawer] = React.useState<{ open: boolean; mode: 'view' | 'create'; id: string | null }>({ open: false, mode: 'view', id: null })
  const [runDrawerOpen, setRunDrawerOpen] = React.useState(false)
  const [resultsRunId, setResultsRunId] = React.useState<string | null>(null)

  const loadedRef = React.useRef(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.agentDetail.evaluation',
    blockedMessage: t('agent_orchestrator.evalCases.flash.actionError'),
  })

  const loadAssertions = React.useCallback(async () => {
    const [own, wild] = await Promise.all([
      apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/agent_orchestrator/eval-assertions?appliesTo=${encodeURIComponent(agentId)}&pageSize=100`,
        undefined,
        { fallback: { items: [] } },
      ),
      apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/agent_orchestrator/eval-assertions?appliesTo=${encodeURIComponent('*')}&pageSize=100`,
        undefined,
        { fallback: { items: [] } },
      ),
    ])
    if (own.status === 403 || wild.status === 403) return { forbidden: true, rows: [] as AssertionRow[] }
    const byId = new Map<string, AssertionRow>()
    for (const item of Array.isArray(own.result?.items) ? own.result.items : []) {
      const row = mapAssertion(item, false)
      if (row) byId.set(row.id, row)
    }
    for (const item of Array.isArray(wild.result?.items) ? wild.result.items : []) {
      const row = mapAssertion(item, true)
      // A row already present from the agent-scoped query wins (it is not wildcard).
      if (row && !byId.has(row.id)) byId.set(row.id, row)
    }
    return { forbidden: false, rows: Array.from(byId.values()) }
  }, [agentId])

  const loadCases = React.useCallback(async () => {
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/eval-cases?agentDefinitionId=${encodeURIComponent(agentId)}&pageSize=100`,
      undefined,
      { fallback: { items: [] } },
    )
    if (call.status === 403) return { forbidden: true, rows: [] as EvalCaseRow[] }
    const rows = (Array.isArray(call.result?.items) ? call.result.items : [])
      .map(mapCase)
      .filter((row): row is EvalCaseRow => !!row)
    return { forbidden: false, rows }
  }, [agentId])

  const loadRuns = React.useCallback(async () => {
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/agent_orchestrator/eval-runs?agentDefinitionId=${encodeURIComponent(agentId)}&pageSize=100`,
      undefined,
      { fallback: { items: [] } },
    )
    if (call.status === 403) return { forbidden: true, rows: [] as EvalRunRow[] }
    const rows = (Array.isArray(call.result?.items) ? call.result.items : [])
      .map((item) => mapEvalRunRow(item))
      .filter((row): row is EvalRunRow => row !== null)
    return { forbidden: false, rows }
  }, [agentId])

  const reloadAll = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true)
    const [a, c, r] = await Promise.all([loadAssertions(), loadCases(), loadRuns()])
    if (a.forbidden || c.forbidden || r.forbidden) {
      setForbidden(true)
      setIsLoading(false)
      return
    }
    setForbidden(false)
    setAssertions(a.rows)
    setCases(c.rows)
    setRuns(r.rows)
    setIsLoading(false)
  }, [loadAssertions, loadCases, loadRuns])

  // Feature probe — a user with only `agents.view` may open this tab; the list
  // APIs require `eval.manage`, so without it the sections are replaced by an
  // inline forbidden note rather than fake zeros or an error page.
  React.useEffect(() => {
    if (!active || features) return
    let cancelled = false
    void apiCall<{ granted?: unknown }>(
      '/api/auth/feature-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: ['agent_orchestrator.eval.manage', 'agent_orchestrator.eval.run'] }),
      },
      { fallback: { granted: [] } },
    ).then((call) => {
      if (cancelled) return
      const granted = Array.isArray(call.result?.granted) ? call.result.granted.map((entry) => String(entry)) : []
      setFeatures({
        canManage: hasAllFeatures(['agent_orchestrator.eval.manage'], granted),
        canRun: hasAllFeatures(['agent_orchestrator.eval.run'], granted),
      })
    })
    return () => { cancelled = true }
  }, [active, features])

  // Lazy fetch on first activation.
  React.useEffect(() => {
    if (!active || loadedRef.current || !features || !features.canManage) return
    loadedRef.current = true
    void reloadAll()
  }, [active, features, reloadAll])

  // Live refresh of the runs list — a suite finishing changes its status/outcome.
  const coalescedReload = useCoalescedReload(
    React.useCallback(() => {
      if (loadedRef.current) void loadRuns().then((result) => { if (!result.forbidden) setRuns(result.rows) })
    }, [loadRuns]),
  )
  useAppEvent('agent_orchestrator.eval_suite_run.completed', () => {
    if (active) coalescedReload()
  })

  const toggleAssertion = React.useCallback(async (row: AssertionRow, next: boolean) => {
    setAssertions((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: next } : item)))
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => updateCrud('agent_orchestrator/eval-assertions', {
              id: row.id,
              key: row.key,
              scorerKey: row.scorerKey,
              title: row.title,
              description: row.description ?? undefined,
              appliesTo: row.appliesTo,
              type: row.type,
              severity: row.severity,
              enabled: next,
              config: Object.keys(row.config).length ? row.config : undefined,
            }),
          ),
        context: { retryLastMutation },
      })
      const result = await loadAssertions()
      if (!result.forbidden) setAssertions(result.rows)
    } catch (err) {
      setAssertions((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: row.enabled } : item)))
      if (surfaceRecordConflict(err, t)) return
      flash(t('agent_orchestrator.evalAssertions.flash.toggleError', 'Could not update the assertion'), 'error')
    }
  }, [runMutation, retryLastMutation, loadAssertions, t])

  const changeCaseStatus = React.useCallback(async (row: EvalCaseRow, action: 'approve' | 'archive') => {
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
        t(action === 'approve' ? 'agent_orchestrator.evalCases.flash.approved' : 'agent_orchestrator.evalCases.flash.archived'),
        'success',
      )
      const result = await loadCases()
      if (!result.forbidden) setCases(result.rows)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(t('agent_orchestrator.evalCases.flash.actionError'), 'error')
    }
  }, [runMutation, retryLastMutation, loadCases, t])

  const canManage = features?.canManage ?? false
  const canRun = features?.canRun ?? false

  const filteredCases = React.useMemo(
    () => (caseFilter === 'all' ? cases : cases.filter((row) => row.status === caseFilter)),
    [cases, caseFilter],
  )

  const gateAssertionCount = React.useMemo(
    () => assertions.filter((row) => row.severity === 'gate' && row.enabled).length,
    [assertions],
  )

  // Latest scored run for the pass % + the delta versus the run before it.
  const scoredRuns = React.useMemo(
    () => runs.filter((row) => row.passScore != null),
    [runs],
  )
  const latestPass = scoredRuns[0]?.passScore ?? null
  const baselineDelta = React.useMemo(() => {
    if (scoredRuns.length < 2 || scoredRuns[0].passScore == null || scoredRuns[1].passScore == null) return null
    return Math.round((scoredRuns[0].passScore - scoredRuns[1].passScore) * 100)
  }, [scoredRuns])

  const caseColumns = React.useMemo<ColumnDef<EvalCaseRow>[]>(() => [
    {
      accessorKey: 'status',
      header: t('agent_orchestrator.evalCases.col.status'),
      cell: ({ row }) => (
        <StatusBadge variant={caseStatusTone[row.original.status]} dot>
          {t(`agent_orchestrator.evalCases.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'processType',
      header: t('agent_orchestrator.evalCases.detail.processType'),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.processType ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'id',
      header: t('agent_orchestrator.evalCases.col.sourceId'),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground" title={row.original.id}>{row.original.id.slice(0, 12)}</span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('agent_orchestrator.evalCases.col.created'),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">{formatDateTime(row.original.createdAt, locale) ?? '—'}</span>
      ),
    },
  ], [t, locale])

  const runColumns = React.useMemo<ColumnDef<EvalRunRow>[]>(() => [
    {
      id: 'status',
      header: t('agent_orchestrator.evalRuns.col.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge variant={evalSuiteStatusVariant[row.original.status]} dot>
          {t(`agent_orchestrator.evalRuns.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      id: 'outcome',
      header: t('agent_orchestrator.evalRuns.col.outcome'),
      enableSorting: false,
      cell: ({ row }) => {
        const outcome = row.original.outcome
        if (!outcome) return <span className="text-sm text-muted-foreground">—</span>
        return (
          <StatusBadge variant={evalSuiteOutcomeVariant[outcome]}>
            {t(`agent_orchestrator.evalRuns.outcome.${outcome}`)}
          </StatusBadge>
        )
      },
    },
    {
      id: 'passScore',
      header: t('agent_orchestrator.evalRuns.col.passScore'),
      enableSorting: false,
      cell: ({ row }) => {
        const value = formatPassScore(row.original.passScore)
        return value
          ? <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
          : <span className="text-sm text-muted-foreground">—</span>
      },
    },
    {
      id: 'cases',
      header: t('agent_orchestrator.evalRuns.col.cases'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm tabular-nums text-foreground">{row.original.caseCount}</span>,
    },
    {
      id: 'when',
      header: t('agent_orchestrator.evalRuns.col.when'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDateTime(row.original.startedAt ?? row.original.createdAt, locale) ?? '—'}
        </span>
      ),
    },
  ], [t, locale])

  if (!features) {
    return <LoadingMessage label={t('agent_orchestrator.agentDetail.evaluation.title', 'Evaluation')} />
  }

  if (forbidden || !canManage) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" />
        <span>
          {t('agent_orchestrator.agentDetail.evaluation.forbidden', "You don't have permission to view evaluations.")}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary strip — metrics with no data are omitted (never fake zeros). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {latestPass != null ? (
          <SummaryMetric
            label={t('agent_orchestrator.agentDetail.evaluation.summary.passRate', 'Latest eval pass')}
            value={formatPassScore(latestPass) ?? '—'}
          />
        ) : null}
        <SummaryMetric
          label={t('agent_orchestrator.agentDetail.evaluation.summary.cases', 'Cases')}
          value={String(cases.length)}
        />
        <SummaryMetric
          label={t('agent_orchestrator.agentDetail.evaluation.summary.gateAssertions', 'Gate assertions')}
          value={String(gateAssertionCount)}
        />
        {baselineDelta != null ? (
          <SummaryMetric
            label={t('agent_orchestrator.agentDetail.evaluation.summary.vsBaseline', 'vs previous run')}
            value={`${baselineDelta >= 0 ? '+' : ''}${baselineDelta} ${t('agent_orchestrator.agentDetail.evaluation.summary.points', 'pts')}`}
            tone={baselineDelta < 0 ? 'error' : 'default'}
          />
        ) : null}
      </div>

      <Tabs value={section} onValueChange={(value) => setSection(value as EvaluationSection)} variant="underline">
        <TabsList>
          <TabsTrigger value="assertions" count={assertions.length}>
            {t('agent_orchestrator.agentDetail.evaluation.section.assertions', 'Assertions')}
          </TabsTrigger>
          <TabsTrigger value="cases" count={cases.length}>
            {t('agent_orchestrator.agentDetail.evaluation.section.cases', 'Cases')}
          </TabsTrigger>
          <TabsTrigger value="runs" count={runs.length}>
            {t('agent_orchestrator.agentDetail.evaluation.section.runs', 'Runs')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assertions" className="space-y-3">
          <div className="flex items-center justify-end">
            <Button type="button" size="sm" onClick={() => setAssertionDrawer({ open: true, row: null })}>
              <Plus className="mr-1.5 size-4" />
              {t('agent_orchestrator.evalAssertions.actions.new')}
            </Button>
          </div>
          {isLoading ? (
            <LoadingMessage label={t('agent_orchestrator.agentDetail.evaluation.section.assertions', 'Assertions')} />
          ) : assertions.length === 0 ? (
            <EmptyState
              title={t('agent_orchestrator.agentDetail.evaluation.assertions.empty', 'No assertions yet')}
              description={t('agent_orchestrator.agentDetail.evaluation.assertions.emptyDescription', 'Add an assertion to score this agent’s runs.')}
            />
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {assertions.map((row) => {
                const TypeIcon = TYPE_ICON[row.type]
                return (
                  <AccordionItem key={row.id} value={row.id}>
                    <div className="flex items-center gap-2 pr-3.5">
                      <AccordionTrigger triggerIcon="chevron" headerClassName="flex-1 min-w-0">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-foreground">{row.title || row.key}</span>
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                            <TypeIcon className="size-3.5 shrink-0" />
                            {row.scorerKey}
                          </span>
                          <StatusBadge variant={severityVariant[row.severity]}>
                            {t(`agent_orchestrator.evalAssertions.severity.${row.severity}`)}
                          </StatusBadge>
                          {row.wildcard ? (
                            <StatusBadge variant="neutral">
                              {t('agent_orchestrator.evalAssertions.form.allAgents', 'All agents')}
                            </StatusBadge>
                          ) : null}
                        </span>
                      </AccordionTrigger>
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(next) => { void toggleAssertion(row, next) }}
                        aria-label={t('agent_orchestrator.evalAssertions.form.enabled')}
                      />
                    </div>
                    <AccordionContent>
                      <div className="space-y-3">
                        {row.description ? (
                          <p className="text-sm text-muted-foreground">{row.description}</p>
                        ) : null}
                        <dl className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('agent_orchestrator.evalAssertions.list.col.appliesTo')}
                            </dt>
                            <dd className="font-mono text-xs text-foreground">{row.appliesTo}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('agent_orchestrator.evalAssertions.form.key')}
                            </dt>
                            <dd className="font-mono text-xs text-foreground">{row.key}</dd>
                          </div>
                        </dl>
                        {Object.keys(row.config).length ? (
                          <JsonDisplay data={row.config} maxHeight="12rem" />
                        ) : null}
                        <div className="flex justify-end">
                          <Button type="button" variant="outline" size="sm" onClick={() => setAssertionDrawer({ open: true, row })}>
                            {t('agent_orchestrator.evalAssertions.list.actions.edit')}
                          </Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </TabsContent>

        <TabsContent value="cases" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl value={caseFilter} onValueChange={(value) => setCaseFilter(value as EvalCaseStatusFilter)}>
              {CASE_STATUS_FILTERS.map((value) => (
                <SegmentedControlItem key={value} value={value}>
                  {value === 'all'
                    ? t('agent_orchestrator.evalCases.tab.all')
                    : t(`agent_orchestrator.evalCases.status.${value}`)}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <Button type="button" size="sm" onClick={() => setCaseDrawer({ open: true, mode: 'create', id: null })}>
              <Plus className="mr-1.5 size-4" />
              {t('agent_orchestrator.evalCases.actions.new')}
            </Button>
          </div>
          {isLoading ? (
            <LoadingMessage label={t('agent_orchestrator.agentDetail.evaluation.section.cases', 'Cases')} />
          ) : cases.length === 0 ? (
            <EmptyState
              title={t('agent_orchestrator.agentDetail.evaluation.cases.empty', 'No cases yet')}
              description={t('agent_orchestrator.agentDetail.evaluation.cases.emptyDescription', 'Capture a case to evaluate this agent against.')}
            />
          ) : (
            <DataTable<EvalCaseRow>
              columns={caseColumns}
              data={filteredCases}
              onRowClick={(row) => setCaseDrawer({ open: true, mode: 'view', id: row.id })}
              emptyState={t('agent_orchestrator.evalCases.empty.title')}
              rowActions={(row) => (
                <RowActions
                  items={[
                    {
                      id: 'open',
                      label: t('agent_orchestrator.evalCases.actions.open'),
                      onSelect: () => setCaseDrawer({ open: true, mode: 'view', id: row.id }),
                    },
                    ...(row.status === 'draft'
                      ? [{ id: 'approve', label: t('agent_orchestrator.evalCases.actions.approve'), onSelect: () => { void changeCaseStatus(row, 'approve') } }]
                      : []),
                    ...(row.status === 'draft' || row.status === 'approved'
                      ? [{ id: 'archive', label: t('agent_orchestrator.evalCases.actions.archive'), onSelect: () => { void changeCaseStatus(row, 'archive') } }]
                      : []),
                  ]}
                />
              )}
            />
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-3">
          <div className="flex items-center justify-end">
            {canRun ? (
              <Button type="button" size="sm" onClick={() => setRunDrawerOpen(true)}>
                <Play className="mr-1.5 size-4" />
                {t('agent_orchestrator.agentDetail.evaluation.run.title', 'Run evaluation')}
              </Button>
            ) : null}
          </div>
          {isLoading ? (
            <LoadingMessage label={t('agent_orchestrator.agentDetail.evaluation.section.runs', 'Runs')} />
          ) : runs.length === 0 ? (
            <EmptyState
              title={t('agent_orchestrator.agentDetail.evaluation.runs.empty', 'No evaluation runs yet')}
              description={t('agent_orchestrator.agentDetail.evaluation.runs.emptyDescription', 'Run an evaluation to measure this agent’s quality.')}
            />
          ) : (
            <DataTable<EvalRunRow>
              columns={runColumns}
              data={runs}
              onRowClick={(row) => setResultsRunId(row.id)}
            />
          )}
        </TabsContent>
      </Tabs>

      <AssertionFormDrawer
        open={assertionDrawer.open}
        onOpenChange={(open) => setAssertionDrawer((prev) => ({ ...prev, open }))}
        assertion={assertionDrawer.row}
        agentId={agentId}
        onSaved={() => { void loadAssertions().then((result) => { if (!result.forbidden) setAssertions(result.rows) }) }}
      />
      <EvalCaseDrawer
        open={caseDrawer.open}
        onOpenChange={(open) => setCaseDrawer((prev) => ({ ...prev, open }))}
        mode={caseDrawer.mode}
        caseId={caseDrawer.id}
        agentId={agentId}
        agentLabel={agentLabel}
        onChanged={() => { void loadCases().then((result) => { if (!result.forbidden) setCases(result.rows) }) }}
      />
      <RunEvaluationDrawer
        open={runDrawerOpen}
        onOpenChange={setRunDrawerOpen}
        agentId={agentId}
        agentLabel={agentLabel}
        onStarted={() => { void loadRuns().then((result) => { if (!result.forbidden) setRuns(result.rows) }) }}
      />
      <EvalResultsDrawer
        open={resultsRunId != null}
        onOpenChange={(open) => { if (!open) setResultsRunId(null) }}
        suiteRunId={resultsRunId}
        agentLabel={agentLabel}
      />
    </div>
  )
}
