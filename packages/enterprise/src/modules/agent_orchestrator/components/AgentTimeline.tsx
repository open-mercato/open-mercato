"use client"

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AgentIoDrawer } from './AgentIoDrawer'
import { agentAvatarIcon } from './agentChips'
import { useAgentIconMap } from './useAgentIcons'
import { mapProposal, mapRun, formatConfidence, type ProposalView, type RunView } from './types'
import { dispositionLabelKey, dispositionVariant, ConfidenceFaceValue } from './cockpitStatus'

type ProposalsResponse = { items?: Array<Record<string, unknown>> }
type RunsResponse = { items?: Array<Record<string, unknown>> }

export type AgentTimelineProps = {
  /** The workflow instance id used to scope proposals (`?processId=`). */
  processId: string
}

/**
 * Three-lane (agent / system / human) timeline of agent activity for a workflow
 * process. Designed to be injected under the workflows instance-detail header;
 * uses `StatusBadge`/status tokens only (never the legacy `bg-blue-100` classes
 * the current monitor uses — Boy-Scout rule).
 */
export function AgentTimeline({ processId }: AgentTimelineProps) {
  const t = useT()
  const agentIcons = useAgentIconMap()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [runs, setRuns] = React.useState<Record<string, RunView>>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [drawerRun, setDrawerRun] = React.useState<RunView | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const call = await apiCall<ProposalsResponse>(
          `/api/agent_orchestrator/proposals?processId=${encodeURIComponent(processId)}&pageSize=100`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        if (!call.ok) {
          setError(t('agent_orchestrator.timeline.error'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result!.items : []
        const mapped = items
          .map((item) => mapProposal(item as Record<string, unknown>))
          .filter((row): row is ProposalView => !!row)
        setProposals(mapped)

        const runEntries = await Promise.all(
          Array.from(new Set(mapped.map((proposal) => proposal.runId))).map(async (runId) => {
            try {
              const runCall = await apiCall<RunsResponse>(
                `/api/agent_orchestrator/runs?id=${encodeURIComponent(runId)}`,
                undefined,
                { fallback: { items: [] } },
              )
              const runItems = Array.isArray(runCall.result?.items) ? runCall.result!.items : []
              const run = runItems[0] ? mapRun(runItems[0] as Record<string, unknown>) : null
              return run ? ([runId, run] as const) : null
            } catch {
              return null
            }
          }),
        )
        if (!cancelled) {
          const map: Record<string, RunView> = {}
          for (const entry of runEntries) {
            if (entry) map[entry[0]] = entry[1]
          }
          setRuns(map)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('agent_orchestrator.timeline.error'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    if (processId) load()
    return () => {
      cancelled = true
    }
  }, [processId, t])

  const openDrawer = React.useCallback((run: RunView | null) => {
    setDrawerRun(run)
    setDrawerOpen(true)
  }, [])

  return (
    <section className="space-y-3">
      <SectionHeader title={t('agent_orchestrator.timeline.title')} count={proposals.length} />

      {isLoading ? (
        <LoadingMessage label={t('agent_orchestrator.timeline.title')} />
      ) : error ? (
        <ErrorMessage label={error} />
      ) : proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.timeline.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((proposal) => {
            const run = runs[proposal.runId] ?? null
            const confidence = formatConfidence(proposal.confidence)
            const isParked = proposal.disposition === 'pending'
            return (
              <li
                key={proposal.id}
                className="rounded-lg border border-border bg-card p-3 border-l-4 border-l-brand-violet"
              >
                <div className="flex items-center gap-3">
                  <Avatar label={proposal.agentId} size="sm" ring icon={agentAvatarIcon(agentIcons.get(proposal.agentId)?.icon ?? null, agentIcons.get(proposal.agentId)?.resultKind)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
                        {t('agent_orchestrator.timeline.lane.agent')}
                      </span>
                      {isParked ? (
                        <StatusBadge variant="warning" dot>
                          {t('agent_orchestrator.timeline.parked')}
                        </StatusBadge>
                      ) : (
                        <StatusBadge variant={dispositionVariant(proposal.disposition)} dot>
                          {t(dispositionLabelKey(proposal.disposition))}
                        </StatusBadge>
                      )}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{proposal.agentId}</p>
                  </div>
                  {proposal.confidence != null ? (
                    <ConfidenceFaceValue
                      confidence={proposal.confidence}
                      display={confidence ?? undefined}
                      className="text-xs text-muted-foreground"
                    />
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openDrawer(run)}>
                    {t('agent_orchestrator.proposal.ioHeading')}
                  </Button>
                  {isParked ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/backend/caseload/${proposal.id}`}>
                        {t('agent_orchestrator.timeline.review')}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AgentIoDrawer open={drawerOpen} onOpenChange={setDrawerOpen} run={drawerRun} />
    </section>
  )
}

export default AgentTimeline
