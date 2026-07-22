"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Check, Play } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../components/types'
import { agentLabelFor, useAgentLabelMap } from '../../../components/useAgentLabels'

type EvalCaseStatus = 'draft' | 'approved' | 'archived'
type EvalCaseSourceType = 'correction' | 'golden_run'

const STATUS_TONE: StatusMap<EvalCaseStatus> = {
  draft: 'info',
  approved: 'success',
  archived: 'neutral',
}

type AssertionOverride = {
  assertionId: string
  configOverride: Record<string, unknown> | null
  disabled: boolean
}

type EvalCaseDetail = {
  id: string
  status: EvalCaseStatus
  sourceType: EvalCaseSourceType
  sourceId: string
  agentDefinitionId: string
  processType: string | null
  input: unknown
  expected: unknown
  assertions: AssertionOverride[]
  approvedByUserId: string | null
  createdAt: string | null
  updatedAt: string | null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapAssertions(value: unknown): AssertionOverride[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const assertionId = readString(record, 'assertionId', 'assertion_id')
    if (!assertionId) return []
    const override = record.configOverride ?? record.config_override
    return [{
      assertionId,
      configOverride:
        override && typeof override === 'object' ? (override as Record<string, unknown>) : null,
      disabled: record.disabled === true,
    }]
  })
}

function mapDetail(record: Record<string, unknown>): EvalCaseDetail | null {
  const id = readString(record, 'id')
  if (!id) return null
  const statusRaw = readString(record, 'status')
  const sourceTypeRaw = readString(record, 'source_type', 'sourceType')
  return {
    id,
    status: statusRaw === 'approved' ? 'approved' : statusRaw === 'archived' ? 'archived' : 'draft',
    sourceType: sourceTypeRaw === 'correction' ? 'correction' : 'golden_run',
    sourceId: readString(record, 'source_id', 'sourceId'),
    agentDefinitionId: readString(record, 'agent_definition_id', 'agentDefinitionId'),
    processType: readString(record, 'process_type', 'processType') || null,
    input: record.input ?? null,
    expected: record.expected ?? null,
    assertions: mapAssertions(record.assertions),
    approvedByUserId: readString(record, 'approved_by_user_id', 'approvedByUserId') || null,
    createdAt: readString(record, 'created_at', 'createdAt') || null,
    updatedAt: readString(record, 'updated_at', 'updatedAt') || null,
  }
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  )
}

export default function EvalCaseDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const agentLabels = useAgentLabelMap()
  const caseId = params?.id ?? ''
  const [detail, setDetail] = React.useState<EvalCaseDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [isBusy, setIsBusy] = React.useState(false)
  // Viewing a case needs `eval.manage`; TRIGGERING a run needs `eval.run`, because
  // a run performs real inference and costs real money. Without this check the
  // button renders for everyone and 403s for the half that lack it.
  const [mayRun, setMayRun] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ granted?: unknown }>(
      '/api/auth/feature-check',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ features: ['agent_orchestrator.eval.run'] }) },
      { fallback: { granted: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const granted = Array.isArray(call.result?.granted) ? call.result.granted : []
      setMayRun(granted.includes('agent_orchestrator.eval.run'))
    })
    return () => { cancelled = true }
  }, [])

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.evalCases.detail',
    blockedMessage: t('agent_orchestrator.evalCases.flash.actionError'),
  })

  // Generation token: a post-mutation `load({ silent: true })` can be overtaken by
  // an in-flight initial load, which would restore the pre-approval status.
  const loadGenerationRef = React.useRef(0)

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!caseId) return
    const generation = ++loadGenerationRef.current
    if (!opts?.silent) setIsLoading(true)
    setError(null)
    setNotFound(false)
    const call = await apiCall<Record<string, unknown>>(
      `/api/agent_orchestrator/eval-cases/${encodeURIComponent(caseId)}`,
      undefined,
      { fallback: {} },
    )
    if (generation !== loadGenerationRef.current) return
    if (!call.ok) {
      // A missing (or cross-tenant) case is a page state, not a load failure.
      if (call.status === 404) setNotFound(true)
      else setError(t('agent_orchestrator.evalCases.detail.error'))
      setIsLoading(false)
      return
    }
    const mapped = mapDetail(call.result ?? {})
    if (!mapped) setNotFound(true)
    else setDetail(mapped)
    setIsLoading(false)
  }, [caseId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const changeStatus = React.useCallback(async (action: 'approve' | 'archive') => {
    if (!detail) return
    setIsBusy(true)
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(detail.updatedAt),
            () => apiCallOrThrow(
              `/api/agent_orchestrator/eval-cases/${encodeURIComponent(detail.id)}/${action}`,
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
      if (!surfaceRecordConflict(err, t)) {
        flash(t('agent_orchestrator.evalCases.flash.actionError'), 'error')
      }
    } finally {
      setIsBusy(false)
    }
  }, [detail, runMutation, retryLastMutation, load, t])

  const runCase = React.useCallback(async () => {
    if (!detail) return
    setIsBusy(true)
    try {
      let suiteRunId: string | null = null
      await runMutation({
        operation: async () => {
          // A small selection finishes inline (200 with the completed summary);
          // a larger one is queued (202). Both shapes carry `suiteRunId`, which is
          // the only field this navigation needs.
          const call = await apiCallOrThrow<{ suiteRunId?: string }>(
            '/api/agent_orchestrator/eval-runs',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                agentDefinitionId: detail.agentDefinitionId,
                evalCaseIds: [detail.id],
                repeatCount: 1,
              }),
            },
          )
          suiteRunId = typeof call.result?.suiteRunId === 'string' ? call.result.suiteRunId : null
        },
        context: { retryLastMutation },
      })
      flash(t('agent_orchestrator.evalCases.detail.runStarted'), 'success')
      if (suiteRunId) router.push(`/backend/eval-runs/${encodeURIComponent(suiteRunId)}`)
    } catch (err) {
      flash(
        err instanceof Error ? err.message : t('agent_orchestrator.evalCases.detail.runError'),
        'error',
      )
    } finally {
      setIsBusy(false)
    }
  }, [detail, runMutation, retryLastMutation, router, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/eval-cases')}>
            {t('agent_orchestrator.evalCases.detail.back')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.evalCases.detail.title')} />
        ) : notFound ? (
          <RecordNotFoundState
            label={t('agent_orchestrator.evalCases.detail.notFound')}
            description={t('agent_orchestrator.evalCases.detail.notFoundDescription')}
            backHref="/backend/eval-cases"
            backLabel={t('agent_orchestrator.evalCases.detail.back')}
          />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : !detail ? (
          <ErrorMessage label={t('agent_orchestrator.evalCases.detail.error')} />
        ) : (
          <div className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={STATUS_TONE[detail.status]} dot>
                      {t(`agent_orchestrator.evalCases.status.${detail.status}`)}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        detail.sourceType === 'correction'
                          ? 'agent_orchestrator.evalCases.sourceType.correction'
                          : 'agent_orchestrator.evalCases.sourceType.goldenRun',
                      )}
                    </span>
                  </div>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                    {agentLabelFor(agentLabels, detail.agentDefinitionId)}
                  </h1>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {detail.agentDefinitionId} · {detail.id}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {detail.status === 'draft' ? (
                    <Button type="button" size="sm" disabled={isBusy} onClick={() => { void changeStatus('approve') }}>
                      <Check className="size-4" />
                      {t('agent_orchestrator.evalCases.actions.approve')}
                    </Button>
                  ) : null}
                  {detail.status === 'draft' || detail.status === 'approved' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => { void changeStatus('archive') }}
                    >
                      <Archive className="size-4" />
                      {t('agent_orchestrator.evalCases.actions.archive')}
                    </Button>
                  ) : null}
                  {mayRun ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => { void runCase() }}
                    >
                      <Play className="size-4" />
                      {t('agent_orchestrator.evalCases.detail.runCase')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <CollapsibleSection title={t('agent_orchestrator.evalCases.detail.input')}>
                  {detail.input == null ? (
                    <p className="text-sm text-muted-foreground">
                      {t('agent_orchestrator.evalCases.detail.noPayload')}
                    </p>
                  ) : (
                    <JsonDisplay data={detail.input} defaultExpanded />
                  )}
                </CollapsibleSection>
              </section>

              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <CollapsibleSection title={t('agent_orchestrator.evalCases.detail.expected')}>
                  {detail.expected == null ? (
                    <p className="text-sm text-muted-foreground">
                      {t('agent_orchestrator.evalCases.detail.noPayload')}
                    </p>
                  ) : (
                    <JsonDisplay data={detail.expected} defaultExpanded />
                  )}
                </CollapsibleSection>
              </section>
            </div>

            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <CollapsibleSection
                title={t('agent_orchestrator.evalCases.detail.assertions')}
                count={detail.assertions.length}
              >
                {detail.assertions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('agent_orchestrator.evalCases.detail.assertionsEmpty')}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.assertions.map((assertion) => (
                      <li
                        key={assertion.assertionId}
                        className="space-y-2 rounded-lg border border-border px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-mono text-xs text-foreground">
                            {assertion.assertionId}
                          </span>
                          <StatusBadge variant={assertion.disabled ? 'neutral' : 'success'}>
                            {t(
                              assertion.disabled
                                ? 'agent_orchestrator.evalCases.detail.assertionDisabled'
                                : 'agent_orchestrator.evalCases.detail.assertionEnabled',
                            )}
                          </StatusBadge>
                        </div>
                        {assertion.configOverride ? (
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('agent_orchestrator.evalCases.detail.assertionOverride')}
                            </p>
                            <JsonDisplay data={assertion.configOverride} />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CollapsibleSection>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">
                {t('agent_orchestrator.evalCases.detail.metadata')}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <MetaRow
                  label={t('agent_orchestrator.evalCases.col.sourceType')}
                  value={t(
                    detail.sourceType === 'correction'
                      ? 'agent_orchestrator.evalCases.sourceType.correction'
                      : 'agent_orchestrator.evalCases.sourceType.goldenRun',
                  )}
                />
                <MetaRow
                  label={t('agent_orchestrator.evalCases.col.sourceId')}
                  value={<span className="font-mono text-xs">{detail.sourceId || '—'}</span>}
                />
                <MetaRow
                  label={t('agent_orchestrator.evalCases.detail.processType')}
                  value={<span className="font-mono text-xs">{detail.processType ?? '—'}</span>}
                />
                <MetaRow
                  label={t('agent_orchestrator.evalCases.detail.approvedBy')}
                  value={<span className="font-mono text-xs">{detail.approvedByUserId ?? '—'}</span>}
                />
                <MetaRow
                  label={t('agent_orchestrator.evalCases.col.created')}
                  value={formatDateTime(detail.createdAt, locale) ?? '—'}
                />
                <MetaRow
                  label={t('agent_orchestrator.evalCases.detail.updated')}
                  value={formatDateTime(detail.updatedAt, locale) ?? '—'}
                />
              </div>
            </section>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
