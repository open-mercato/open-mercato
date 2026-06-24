"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Clock, CheckCircle2, RotateCw } from 'lucide-react'
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
import { mapAgent, mapProposal, formatConfidence, type ProposalView } from '../../components/types'

type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }
type SegmentKey = 'needsYou' | 'waiting' | 'all'

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
function fieldOf(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(item[key])
    if (value) return value
  }
  return ''
}
async function fetchItems(path: string): Promise<Array<Record<string, unknown>>> {
  const call = await apiCall<ListResponse>(path, undefined, { fallback: { items: [] } })
  return call.ok && Array.isArray(call.result?.items) ? call.result!.items : []
}

export default function AgentCaseloadPage() {
  const t = useT()
  const router = useRouter()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [agentLabels, setAgentLabels] = React.useState<Map<string, string>>(new Map())
  const [runClaims, setRunClaims] = React.useState<Map<string, string>>(new Map())
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
        const params = new URLSearchParams({ pageSize: '100' })
        if (segment === 'needsYou') params.set('disposition', 'pending')
        const [proposalsCall, agents, runs] = await Promise.all([
          apiCall<ListResponse>(`/api/agent_orchestrator/proposals?${params.toString()}`, undefined, { fallback: { items: [] } }),
          fetchItems('/api/agent_orchestrator/agents'),
          fetchItems('/api/agent_orchestrator/runs?pageSize=100'),
        ])
        if (cancelled) return
        if (!proposalsCall.ok) {
          setError(t('agent_orchestrator.caseload.error'))
          return
        }
        const items = Array.isArray(proposalsCall.result?.items) ? proposalsCall.result!.items : []
        setProposals(items.map((item) => mapProposal(item)).filter((row): row is ProposalView => !!row))
        const labels = new Map<string, string>()
        for (const item of agents) {
          const agent = mapAgent(item)
          if (agent) labels.set(agent.id, agent.label || agent.id)
        }
        setAgentLabels(labels)
        const claims = new Map<string, string>()
        for (const run of runs) {
          const id = fieldOf(run, 'id')
          if (!id) continue
          const input = asObject(run.input)
          claims.set(id, (input && fieldOf(input, 'claimId', 'claim_id', 'dealId', 'deal_id', 'reference')) || id.slice(0, 12))
        }
        setRunClaims(claims)
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
    return { pending, waiting, closed: proposals.length - pending }
  }, [proposals])

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('agent_orchestrator.caseload.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('agent_orchestrator.caseload.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl value={segment} onValueChange={(value) => setSegment(value as SegmentKey)}>
              <SegmentedControlItem value="needsYou">{t('agent_orchestrator.caseload.filters.needsYou')}</SegmentedControlItem>
              <SegmentedControlItem value="waiting">{t('agent_orchestrator.caseload.filters.waiting')}</SegmentedControlItem>
              <SegmentedControlItem value="all">{t('agent_orchestrator.caseload.filters.all')}</SegmentedControlItem>
            </SegmentedControl>
            <Button type="button" variant="outline" size="sm" aria-label={t('agent_orchestrator.caseload.refresh')} onClick={() => setReloadToken((token) => token + 1)}>
              <RotateCw className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CaseTile icon={ClipboardList} label={t('agent_orchestrator.caseload.tiles.needsYou')} value={counts.pending} />
          <CaseTile icon={Clock} label={t('agent_orchestrator.caseload.tiles.waiting')} value={counts.waiting} />
          <CaseTile icon={CheckCircle2} label={t('agent_orchestrator.caseload.tiles.closed')} value={counts.closed} />
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
          <section className="space-y-3">
            <SectionHeader title={t('agent_orchestrator.caseload.verb.decide')} count={decideRows.length} />
            <ul className="space-y-2">
              {decideRows.map((proposal) => {
                const confidence = formatConfidence(proposal.confidence)
                const label = agentLabels.get(proposal.agentId) || proposal.agentId
                const claim = runClaims.get(proposal.runId) || proposal.id.slice(0, 12)
                return (
                  <li key={proposal.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/backend/caseload/${proposal.id}`)}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Avatar label={label} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{label}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{claim}</p>
                      </div>
                      {confidence ? (
                        <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
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
          </section>
        )}
      </PageBody>
    </Page>
  )
}

function CaseTile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground">{value.toLocaleString('en-US')}</div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}
