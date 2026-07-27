"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConfidenceFaceValue } from '../../../../components/cockpitStatus'
import { formatTimeShort } from '../../../../components/types'
import { buildRunRows, outcomeVariant, titleCase } from './workspaceShared'

type Facet = 'all' | 'errors' | 'overridden'

type ActivityTabProps = {
  runs: Array<Record<string, unknown>>
  proposals: Array<Record<string, unknown>>
}

export function ActivityTab({ runs, proposals }: ActivityTabProps) {
  const t = useT()
  const router = useRouter()
  const [facet, setFacet] = React.useState<Facet>('all')
  const rows = React.useMemo(() => buildRunRows(runs, proposals), [runs, proposals])
  const counts = React.useMemo(
    () => ({
      all: rows.length,
      errors: rows.filter((row) => row.outcome === 'failed').length,
      overridden: rows.filter((row) => row.outcome === 'overridden').length,
    }),
    [rows],
  )
  const filtered = rows.filter((row) => {
    if (facet === 'errors') return row.outcome === 'failed'
    if (facet === 'overridden') return row.outcome === 'overridden'
    return true
  })

  const open = (id: string) => router.push(`/backend/traces/${encodeURIComponent(id)}`)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl value={facet} onValueChange={(value) => setFacet(value as Facet)} aria-label={t('agent_orchestrator.agentDetail.activity.filter', 'Filter runs')}>
          <SegmentedControlItem value="all">{t('agent_orchestrator.agentDetail.activity.facetAll', 'All')} ({counts.all})</SegmentedControlItem>
          <SegmentedControlItem value="errors">{t('agent_orchestrator.agentDetail.activity.facetErrors', 'Errors')} ({counts.errors})</SegmentedControlItem>
          <SegmentedControlItem value="overridden">{t('agent_orchestrator.agentDetail.outcome.overridden', 'Overridden')} ({counts.overridden})</SegmentedControlItem>
        </SegmentedControl>
        <Button variant="outline" size="sm" onClick={() => router.push('/backend/traces')}>
          {t('agent_orchestrator.agentDetail.activity.openTraces', 'Open in Traces')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {filtered.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.recent.empty', 'No runs yet for this agent.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('agent_orchestrator.agentDetail.recent.claim', 'Claim')}</th>
                  <th className="px-4 py-2 font-medium">{t('agent_orchestrator.agentDetail.recent.decision', 'Decision')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('agent_orchestrator.agentDetail.recent.conf', 'Conf.')}</th>
                  <th className="px-4 py-2 font-medium">{t('agent_orchestrator.agentDetail.recent.outcome', 'Outcome')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('agent_orchestrator.agentDetail.recent.when', 'When')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => (
                  <tr
                    key={run.id}
                    tabIndex={0}
                    role="link"
                    aria-label={t('agent_orchestrator.agentDetail.recent.openTrace', 'Open run trace')}
                    className="cursor-pointer border-b border-border outline-none transition-colors last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40"
                    onClick={() => open(run.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open(run.id)
                      }
                    }}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{run.claim}</td>
                    <td className="px-4 py-2.5 text-foreground">{run.decision}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      <ConfidenceFaceValue
                        confidence={run.confidence}
                        display={run.confidence == null ? undefined : run.confidence.toFixed(2)}
                        className="justify-end"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge variant={outcomeVariant[run.outcome]}>
                        {t(`agent_orchestrator.agentDetail.outcome.${run.outcome}`, titleCase(run.outcome))}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatTimeShort(run.when) ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
