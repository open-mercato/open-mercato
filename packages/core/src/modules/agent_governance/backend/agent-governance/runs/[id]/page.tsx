"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type RunDetail = {
  id: string
  status: string
  autonomyMode: string
  actionType: string
  targetEntity: string
  targetId?: string | null
  pauseReason?: string | null
  inputContext?: Record<string, unknown> | null
}

type TimelineResponse = {
  decisions?: Array<Record<string, unknown>>
  steps?: Array<Record<string, unknown>>
  approvals?: Array<Record<string, unknown>>
}

async function controlRun(
  id: string,
  action: 'pause' | 'resume' | 'terminate',
  reason: string,
  expectedStatus: string | null,
): Promise<void> {
  const response = await apiCall(`/api/agent_governance/runs/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reason,
      expectedStatus: expectedStatus ?? undefined,
    }),
  })
  if (!response.ok) {
    throw new Error(typeof response.error === 'string' ? response.error : 'Run control request failed.')
  }
}

export default function AgentGovernanceRunDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const id = params?.id

  const [run, setRun] = React.useState<RunDetail | null>(null)
  const [timeline, setTimeline] = React.useState<TimelineResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)

    try {
      const [runResponse, timelineResponse] = await Promise.all([
        apiCall<RunDetail>(`/api/agent_governance/runs/${encodeURIComponent(id)}`),
        apiCall<TimelineResponse>(`/api/agent_governance/runs/${encodeURIComponent(id)}/timeline?limit=200`),
      ])

      if (!runResponse.ok || !runResponse.result) {
        throw new Error(t('agent_governance.runDetail.loadError', 'Failed to load run details.'))
      }

      setRun(runResponse.result)
      setTimeline(timelineResponse.result ?? { decisions: [], steps: [], approvals: [] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('agent_governance.runDetail.loadError', 'Failed to load run details.'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleControl = React.useCallback(async (action: 'pause' | 'resume' | 'terminate') => {
    if (!id) return

    try {
      await controlRun(id, action, `Control action from run detail: ${action}`, run?.status ?? null)
      flash(t('agent_governance.runDetail.controlSuccess', 'Run updated.'), 'success')
      await load()
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.runDetail.controlError', 'Run update failed.'), 'error')
    }
  }, [id, load, t])

  if (!id) return null

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{t('agent_governance.runDetail.title', 'Run Detail')}</h1>
              <p className="text-sm text-muted-foreground">{id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => { void handleControl('pause') }}>{t('agent_governance.runs.actions.pause', 'Pause')}</Button>
              <Button type="button" variant="outline" onClick={() => { void handleControl('resume') }}>{t('agent_governance.runs.actions.resume', 'Resume')}</Button>
              <Button type="button" variant="destructive" onClick={() => { void handleControl('terminate') }}>{t('agent_governance.runs.actions.terminate', 'Terminate')}</Button>
              <Button asChild variant="ghost"><Link href="/backend/agent-governance/runs">{t('common.back', 'Back')}</Link></Button>
            </div>
          </div>

          {isLoading ? <LoadingMessage message={t('agent_governance.runDetail.loading', 'Loading run...')} /> : null}
          {!isLoading && error ? <ErrorMessage message={error} /> : null}

          {!isLoading && !error && run ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">{t('agent_governance.runs.columns.status', 'Status')}</div>
                  <div className="mt-1 font-medium">{run.status}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">{t('agent_governance.runs.columns.mode', 'Mode')}</div>
                  <div className="mt-1 font-medium">{run.autonomyMode}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">{t('agent_governance.runs.columns.actionType', 'Action')}</div>
                  <div className="mt-1 font-medium">{run.actionType}</div>
                </div>
              </div>

              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">{t('agent_governance.runDetail.target', 'Target')}</div>
                <div className="mt-1 text-sm">{run.targetEntity}{run.targetId ? ` (${run.targetId})` : ''}</div>
                {run.pauseReason ? <div className="mt-2 text-xs text-muted-foreground">{run.pauseReason}</div> : null}
              </div>

              <div className="space-y-2">
                <h2 className="text-lg font-medium">{t('agent_governance.runDetail.timeline', 'Timeline')}</h2>
                <div className="rounded border p-3">
                  <div className="text-sm font-medium">{t('agent_governance.runDetail.decisions', 'Decisions')}</div>
                  <div className="mt-2 space-y-1 text-sm">
                    {(timeline?.decisions ?? []).length === 0 ? <div className="text-muted-foreground">—</div> : null}
                    {(timeline?.decisions ?? []).map((decision, index) => (
                      <div key={`decision-${index}`} className="rounded bg-muted px-2 py-1">
                        {(typeof decision.actionType === 'string' ? decision.actionType : '') ||
                          (typeof decision.action_type === 'string' ? decision.action_type : '')}
                        {' · '}
                        {(typeof decision.status === 'string' ? decision.status : 'unknown')}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border p-3">
                  <div className="text-sm font-medium">{t('agent_governance.runDetail.approvals', 'Approvals')}</div>
                  <div className="mt-2 space-y-1 text-sm">
                    {(timeline?.approvals ?? []).length === 0 ? <div className="text-muted-foreground">—</div> : null}
                    {(timeline?.approvals ?? []).map((approval, index) => (
                      <div key={`approval-${index}`} className="rounded bg-muted px-2 py-1">
                        {(typeof approval.status === 'string' ? approval.status : 'pending')}
                        {typeof approval.reason === 'string' && approval.reason ? ` · ${approval.reason}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}
