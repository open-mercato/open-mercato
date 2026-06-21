"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapProposal, formatConfidence, type ProposalView } from '../../components/types'
import { verbAccentClass } from '../../components/cockpitStatus'

type ProposalsResponse = { items?: Array<Record<string, unknown>>; total?: number }

type SegmentKey = 'needsYou' | 'waiting' | 'all'

export default function AgentCaseloadPage() {
  const t = useT()
  const router = useRouter()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [segment, setSegment] = React.useState<SegmentKey>('needsYou')
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const disposition = segment === 'needsYou' ? 'pending' : undefined
        const params = new URLSearchParams({ pageSize: '100' })
        if (disposition) params.set('disposition', disposition)
        const call = await apiCall<ProposalsResponse>(
          `/api/agent_orchestrator/proposals?${params.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        if (!call.ok) {
          setError(t('agent_orchestrator.caseload.error'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result!.items : []
        setProposals(
          items
            .map((item) => mapProposal(item as Record<string, unknown>))
            .filter((row): row is ProposalView => !!row),
        )
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('agent_orchestrator.caseload.error'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [segment, reloadToken, t])

  const decideRows = React.useMemo(
    () =>
      proposals.filter((proposal) => {
        if (segment === 'needsYou') return proposal.disposition === 'pending'
        if (segment === 'waiting') return proposal.disposition === 'pending' && !!proposal.processId
        return true
      }),
    [proposals, segment],
  )

  const counts = React.useMemo(() => {
    const pending = proposals.filter((p) => p.disposition === 'pending').length
    const waiting = proposals.filter((p) => p.disposition === 'pending' && !!p.processId).length
    return { pending, waiting, total: proposals.length }
  }, [proposals])

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('agent_orchestrator.caseload.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.caseload.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              value={segment}
              onValueChange={(value) => setSegment(value as SegmentKey)}
            >
              <SegmentedControlItem value="needsYou">
                {t('agent_orchestrator.caseload.filters.needsYou')}
              </SegmentedControlItem>
              <SegmentedControlItem value="waiting">
                {t('agent_orchestrator.caseload.filters.waiting')}
              </SegmentedControlItem>
              <SegmentedControlItem value="all">
                {t('agent_orchestrator.caseload.filters.all')}
              </SegmentedControlItem>
            </SegmentedControl>
            <Button type="button" variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
              {t('agent_orchestrator.caseload.refresh')}
            </Button>
          </div>
        </div>

        {/* Counts strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.caseload.tiles.needsYou')}</p>
            <p className="text-2xl font-semibold">{counts.pending}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.caseload.tiles.waiting')}</p>
            <p className="text-2xl font-semibold">{counts.waiting}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.caseload.tiles.closed')}</p>
            <p className="text-2xl font-semibold">{counts.total - counts.pending}</p>
          </div>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.caseload.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : decideRows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.caseload.empty')}
            description={t('agent_orchestrator.caseload.emptyDescription')}
          />
        ) : (
          <div className="space-y-3">
            <SectionHeader title={t('agent_orchestrator.caseload.verb.decide')} count={decideRows.length} />
            <ul className="space-y-2">
              {decideRows.map((proposal) => {
                const confidence = formatConfidence(proposal.confidence)
                return (
                  <li key={proposal.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/backend/caseload/${proposal.id}`)}
                      className={`flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40 ${verbAccentClass.decide}`}
                    >
                      <Avatar label={proposal.agentId} size="sm" ring />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{proposal.agentId}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{proposal.id}</p>
                      </div>
                      {confidence ? (
                        <span className="text-xs text-muted-foreground">
                          {t('agent_orchestrator.caseload.row.confidence')}: {confidence}
                        </span>
                      ) : null}
                      <StatusBadge variant="warning" dot>
                        {t('agent_orchestrator.caseload.verb.decide')}
                      </StatusBadge>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
