"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Button } from '@open-mercato/ui/primitives/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
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
          <EmptyState
            variant="subtle"
            title={t('agent_orchestrator.agentDetail.recent.empty', 'No runs yet for this agent.')}
            description={t(
              'agent_orchestrator.agentDetail.recent.emptyDescription',
              'Runs appear here as soon as this agent is invoked.',
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('agent_orchestrator.agentDetail.recent.claim', 'Claim')}</TableHead>
                  <TableHead>{t('agent_orchestrator.agentDetail.recent.decision', 'Decision')}</TableHead>
                  <TableHead className="text-right">{t('agent_orchestrator.agentDetail.recent.conf', 'Conf.')}</TableHead>
                  <TableHead>{t('agent_orchestrator.agentDetail.recent.outcome', 'Outcome')}</TableHead>
                  <TableHead className="text-right">{t('agent_orchestrator.agentDetail.recent.when', 'When')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((run) => (
                  <TableRow
                    key={run.id}
                    tabIndex={0}
                    role="link"
                    aria-label={t('agent_orchestrator.agentDetail.recent.openTrace', 'Open run trace')}
                    className="cursor-pointer outline-none focus-visible:bg-accent/40"
                    onClick={() => open(run.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open(run.id)
                      }
                    }}
                  >
                    <TableCell className="font-mono text-xs text-foreground">{run.claim}</TableCell>
                    <TableCell className="text-foreground">{run.decision}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <ConfidenceFaceValue
                        confidence={run.confidence}
                        display={run.confidence == null ? undefined : run.confidence.toFixed(2)}
                        className="justify-end"
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={outcomeVariant[run.outcome]}>
                        {t(`agent_orchestrator.agentDetail.outcome.${run.outcome}`, titleCase(run.outcome))}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatTimeShort(run.when) ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
