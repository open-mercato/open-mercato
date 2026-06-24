"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  mapRunDetail,
  formatConfidence,
  type RunDetailView,
  type SpanView,
} from '../../../components/types'
import { runStatusVariant, runStatusLabelKey } from '../../../components/cockpitStatus'

function depthOf(span: SpanView, byExternalId: Map<string, SpanView>): number {
  let depth = 0
  let current: SpanView | undefined = span
  const seen = new Set<string>()
  while (current?.parentSpanId && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = [...byExternalId.values()].find((candidate) => candidate.id === current!.parentSpanId)
    if (!parent) break
    depth += 1
    current = parent
  }
  return depth
}

function hasSummary(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function formatSummary(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function AgentRunTracePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const runId = params?.id ?? ''
  const [detail, setDetail] = React.useState<RunDetailView | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}`,
        undefined,
        { fallback: {} },
      )
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.traces.detail.error'))
        setIsLoading(false)
        return
      }
      setDetail(mapRunDetail(call.result ?? {}))
      setIsLoading(false)
    }
    if (runId) void load()
    return () => {
      cancelled = true
    }
  }, [t, runId])

  const spansByExternalId = React.useMemo(() => {
    const map = new Map<string, SpanView>()
    detail?.spans.forEach((span) => map.set(span.externalSpanId ?? span.id, span))
    return map
  }, [detail])

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/traces')}>
            {t('agent_orchestrator.traces.detail.back')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.traces.detail.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : !detail ? (
          <ErrorMessage label={t('agent_orchestrator.traces.detail.error')} />
        ) : (
          <div className="space-y-8">
            <section className="space-y-2">
              <SectionHeader title={detail.run.agentId} />
              {detail.run.externalRunId ? (
                <p className="text-xs text-muted-foreground">{detail.run.externalRunId}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge variant={runStatusVariant(detail.run.status)}>
                  {t(runStatusLabelKey(detail.run.status))}
                </StatusBadge>
                {detail.run.evalPassed === true ? (
                  <StatusBadge variant="success">{t('agent_orchestrator.traces.eval.pass')}</StatusBadge>
                ) : detail.run.evalPassed === false ? (
                  <StatusBadge variant="error">{t('agent_orchestrator.traces.eval.fail')}</StatusBadge>
                ) : null}
                {detail.run.runtime ? <span className="text-muted-foreground">{detail.run.runtime}</span> : null}
                {detail.run.model ? <span className="text-muted-foreground">{detail.run.model}</span> : null}
                {detail.run.confidence != null ? (
                  <span className="text-muted-foreground">
                    {t('agent_orchestrator.traces.detail.confidence')}: {formatConfidence(detail.run.confidence)}
                  </span>
                ) : null}
                {detail.run.latencyMs != null ? (
                  <span className="text-muted-foreground">
                    {t('agent_orchestrator.traces.detail.latency')}: {detail.run.latencyMs}ms
                  </span>
                ) : null}
              </div>
              {detail.run.errorMessage ? (
                <div className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text">
                  <span className="font-medium">{t('agent_orchestrator.traces.detail.runError')}:</span>{' '}
                  {detail.run.errorMessage}
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <SectionHeader title={t('agent_orchestrator.traces.detail.spans')} />
              {detail.spans.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noSpans')}</p>
              ) : (
                <ul className="rounded-md border border-border">
                  {detail.spans.map((span) => (
                    <li
                      key={span.id}
                      className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
                      style={{ paddingLeft: 12 + depthOf(span, spansByExternalId) * 16 }}
                    >
                      <span className="truncate">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">{span.kind}</span>{' '}
                        {span.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {span.durationMs != null ? `${span.durationMs}ms` : ''}
                        <StatusBadge variant={span.status === 'error' ? 'error' : 'success'}>
                          {span.status ?? 'ok'}
                        </StatusBadge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeader title={t('agent_orchestrator.traces.detail.toolCalls')} />
              {detail.toolCalls.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noToolCalls')}</p>
              ) : (
                <ul className="rounded-md border border-border">
                  {detail.toolCalls.map((toolCall) => (
                    <li
                      key={toolCall.id}
                      className="space-y-2 border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-mono text-sm">{toolCall.toolName}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          {toolCall.latencyMs != null ? `${toolCall.latencyMs}ms` : ''}
                          <StatusBadge variant={toolCall.status === 'error' ? 'error' : 'success'}>
                            {toolCall.status ?? 'ok'}
                          </StatusBadge>
                        </span>
                      </div>
                      {toolCall.errorMessage ? (
                        <p className="text-xs text-status-error-text">
                          <span className="font-medium">{t('agent_orchestrator.traces.detail.toolError')}:</span>{' '}
                          {toolCall.errorMessage}
                        </p>
                      ) : null}
                      {hasSummary(toolCall.requestSummary) ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('agent_orchestrator.traces.detail.toolRequest')}
                          </p>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                            {formatSummary(toolCall.requestSummary)}
                          </pre>
                        </div>
                      ) : null}
                      {hasSummary(toolCall.responseSummary) ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('agent_orchestrator.traces.detail.toolResponse')}
                          </p>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                            {formatSummary(toolCall.responseSummary)}
                          </pre>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeader title={t('agent_orchestrator.traces.detail.evalResults')} />
              {detail.evalResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noEvalResults')}</p>
              ) : (
                <ul className="rounded-md border border-border">
                  {detail.evalResults.map((result) => (
                    <li
                      key={result.id}
                      className="space-y-2 border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">{result.severity}</span>{' '}
                          {result.assertionKey}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          {result.score != null ? result.score.toFixed(2) : ''}
                          <StatusBadge variant={result.passed ? 'success' : 'error'}>
                            {result.passed
                              ? t('agent_orchestrator.traces.eval.pass')
                              : t('agent_orchestrator.traces.eval.fail')}
                          </StatusBadge>
                        </span>
                      </div>
                      {hasSummary(result.evidence) ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('agent_orchestrator.traces.detail.evalEvidence')}
                          </p>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                            {formatSummary(result.evidence)}
                          </pre>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <SectionHeader title={t('agent_orchestrator.traces.detail.output')} />
              {detail.run.output != null ? (
                <JsonDisplay data={detail.run.output} />
              ) : (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.noOutput')}</p>
              )}
            </section>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
