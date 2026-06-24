"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapRun, formatConfidence, type RunView } from '../../components/types'
import { runStatusVariant, runStatusLabelKey } from '../../components/cockpitStatus'

type RunsResponse = { items?: Array<Record<string, unknown>> }
type WindowKey = '24h' | '7d' | '30d'
type FacetKey = 'all' | 'eval-fail' | 'low-confidence'

function EvalBadge({ run }: { run: RunView }) {
  const t = useT()
  if (run.evalPassed === true) return <StatusBadge variant="success">{t('agent_orchestrator.traces.eval.pass')}</StatusBadge>
  if (run.evalPassed === false) return <StatusBadge variant="error">{t('agent_orchestrator.traces.eval.fail')}</StatusBadge>
  return <StatusBadge variant="neutral">{t('agent_orchestrator.traces.eval.none')}</StatusBadge>
}

export default function AgentTracesPage() {
  const t = useT()
  const router = useRouter()
  const [runs, setRuns] = React.useState<RunView[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [window, setWindow] = React.useState<WindowKey>('7d')
  const [facet, setFacet] = React.useState<FacetKey>('all')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ pageSize: '100', window })
      if (facet !== 'all') params.set('filter', facet)
      const call = await apiCall<RunsResponse>(`/api/agent_orchestrator/runs?${params.toString()}`, undefined, {
        fallback: { items: [] },
      })
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.traces.error'))
        setIsLoading(false)
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      setRuns(items.map((item) => mapRun(item as Record<string, unknown>)).filter((row): row is RunView => !!row))
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t, window, facet])

  return (
    <Page>
      <PageBody>
        <SectionHeader title={t('agent_orchestrator.traces.title')} />
        <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.traces.subtitle')}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SegmentedControl value={window} onValueChange={(value) => setWindow(value as WindowKey)}>
            <SegmentedControlItem value="24h">{t('agent_orchestrator.traces.window.24h')}</SegmentedControlItem>
            <SegmentedControlItem value="7d">{t('agent_orchestrator.traces.window.7d')}</SegmentedControlItem>
            <SegmentedControlItem value="30d">{t('agent_orchestrator.traces.window.30d')}</SegmentedControlItem>
          </SegmentedControl>
          <SegmentedControl value={facet} onValueChange={(value) => setFacet(value as FacetKey)}>
            <SegmentedControlItem value="all">{t('agent_orchestrator.traces.facet.all')}</SegmentedControlItem>
            <SegmentedControlItem value="eval-fail">{t('agent_orchestrator.traces.facet.evalFail')}</SegmentedControlItem>
            <SegmentedControlItem value="low-confidence">{t('agent_orchestrator.traces.facet.lowConfidence')}</SegmentedControlItem>
          </SegmentedControl>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <LoadingMessage label={t('agent_orchestrator.traces.title')} />
          ) : error ? (
            <ErrorMessage label={error} />
          ) : runs.length === 0 ? (
            <EmptyState
              title={t('agent_orchestrator.traces.empty')}
              description={t('agent_orchestrator.traces.emptyDescription')}
            />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/backend/traces/${run.id}`)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{run.agentId}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {run.runtime ?? '—'}
                        {run.createdAt ? ` · ${run.createdAt}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <EvalBadge run={run} />
                      {run.confidence != null ? (
                        <span className="text-xs text-muted-foreground">{formatConfidence(run.confidence)}</span>
                      ) : null}
                      {run.latencyMs != null ? (
                        <span className="text-xs text-muted-foreground">{run.latencyMs}ms</span>
                      ) : null}
                      <StatusBadge variant={runStatusVariant(run.status)}>{t(runStatusLabelKey(run.status))}</StatusBadge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
