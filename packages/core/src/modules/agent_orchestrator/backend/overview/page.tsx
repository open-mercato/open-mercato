"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapProposal, mapRun, formatConfidence, type ProposalView, type RunView } from '../../components/types'

type ProposalsResponse = { items?: Array<Record<string, unknown>>; total?: number }
type RunsResponse = { items?: Array<Record<string, unknown>>; total?: number }

export default function AgentOverviewPage() {
  const t = useT()
  const router = useRouter()
  const [proposals, setProposals] = React.useState<ProposalView[]>([])
  const [runs, setRuns] = React.useState<RunView[]>([])
  const [runsTotal, setRunsTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [proposalsCall, runsCall] = await Promise.all([
          apiCall<ProposalsResponse>('/api/agent_orchestrator/proposals?pageSize=100', undefined, {
            fallback: { items: [] },
          }),
          apiCall<RunsResponse>('/api/agent_orchestrator/runs?pageSize=100', undefined, {
            fallback: { items: [] },
          }),
        ])
        if (cancelled) return
        if (!proposalsCall.ok || !runsCall.ok) {
          setError(t('agent_orchestrator.overview.error'))
          return
        }
        const proposalItems = Array.isArray(proposalsCall.result?.items) ? proposalsCall.result!.items : []
        setProposals(
          proposalItems
            .map((item) => mapProposal(item as Record<string, unknown>))
            .filter((row): row is ProposalView => !!row),
        )
        const runItems = Array.isArray(runsCall.result?.items) ? runsCall.result!.items : []
        setRuns(runItems.map((item) => mapRun(item as Record<string, unknown>)).filter((row): row is RunView => !!row))
        setRunsTotal(typeof runsCall.result?.total === 'number' ? runsCall.result.total : runItems.length)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('agent_orchestrator.overview.error'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [t, reloadToken])

  // Live-refresh KPIs + needs-attention queue on any proposal lifecycle change
  // (DOM Event Bridge, tenant/org-scoped server-side).
  useAppEvent('agent_orchestrator.proposal.*', () => {
    setReloadToken((token) => token + 1)
  })

  const stats = React.useMemo(() => {
    const total = proposals.length
    const pending = proposals.filter((p) => p.disposition === 'pending').length
    const auto = proposals.filter((p) => p.disposition === 'auto_approved').length
    const disposed = proposals.filter((p) => p.disposition !== 'pending').length
    const queueDepth = proposals.filter((p) => p.disposition === 'pending' && !!p.processId).length
    const autoPct = disposed > 0 ? Math.round((auto / disposed) * 100) : 0

    // Quality / anti-rubber-stamp signals (AI Act Art. 14), computed from the
    // already-loaded runs + proposals — no extra fetch.
    const unchanged = proposals.filter((p) => p.disposition === 'approved' || p.disposition === 'auto_approved').length
    const overridden = proposals.filter((p) => p.disposition === 'edited' || p.disposition === 'rejected').length
    const dispositioned = unchanged + overridden
    const overrideRate = dispositioned > 0 ? Math.round((overridden / dispositioned) * 100) : null
    const approveUnchangedRate = dispositioned > 0 ? Math.round((unchanged / dispositioned) * 100) : null
    const evaluated = runs.filter((r) => r.evalPassed !== null)
    const evalPassRate = evaluated.length > 0
      ? Math.round((evaluated.filter((r) => r.evalPassed === true).length / evaluated.length) * 100)
      : null

    return { total, pending, autoPct, queueDepth, overrideRate, approveUnchangedRate, evalPassRate }
  }, [proposals, runs])

  const formatPct = (value: number | null) => (value == null ? '—' : `${value}%`)

  const needsAttention = React.useMemo(
    () => proposals.filter((p) => p.disposition === 'pending'),
    [proposals],
  )

  const empty = !isLoading && !error && proposals.length === 0 && runsTotal === 0

  return (
    <Page>
      <PageBody className="space-y-5">
        <h1 className="text-lg font-semibold">{t('agent_orchestrator.overview.title')}</h1>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.overview.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : empty ? (
          <EmptyState
            title={t('agent_orchestrator.overview.empty')}
            description={t('agent_orchestrator.overview.emptyDescription')}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.autoCompleted')}</p>
                <p className="text-2xl font-semibold">{stats.autoPct}%</p>
                <StatusBadge variant="success">{t('agent_orchestrator.overview.tiles.autoCompletedMeta')}</StatusBadge>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.needsDecision')}</p>
                <p className="text-2xl font-semibold">{stats.pending}</p>
                <StatusBadge variant="warning">{t('agent_orchestrator.overview.tiles.needsDecisionMeta')}</StatusBadge>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.queueDepth')}</p>
                <p className="text-2xl font-semibold">{stats.queueDepth}</p>
                <StatusBadge variant="info">{t('agent_orchestrator.overview.tiles.queueDepthMeta')}</StatusBadge>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.totalRuns')}</p>
                <p className="text-2xl font-semibold">{runsTotal}</p>
                <StatusBadge variant="neutral">{t('agent_orchestrator.overview.tiles.totalRunsMeta')}</StatusBadge>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.evalPassRate')}</p>
                <p className="text-2xl font-semibold">{formatPct(stats.evalPassRate)}</p>
                <StatusBadge variant={stats.evalPassRate != null && stats.evalPassRate < 100 ? 'warning' : 'success'}>
                  {t('agent_orchestrator.overview.tiles.evalPassRateMeta')}
                </StatusBadge>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.overrideRate')}</p>
                <p className="text-2xl font-semibold">{formatPct(stats.overrideRate)}</p>
                <StatusBadge variant="info">{t('agent_orchestrator.overview.tiles.overrideRateMeta')}</StatusBadge>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.tiles.approveUnchanged')}</p>
                <p className="text-2xl font-semibold">{formatPct(stats.approveUnchangedRate)}</p>
                <StatusBadge variant={stats.approveUnchangedRate != null && stats.approveUnchangedRate >= 90 ? 'warning' : 'neutral'}>
                  {t('agent_orchestrator.overview.tiles.approveUnchangedMeta')}
                </StatusBadge>
              </div>
            </div>

            <section className="space-y-3">
              <SectionHeader title={t('agent_orchestrator.overview.needsAttention.title')} count={needsAttention.length} />
              {needsAttention.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.overview.needsAttention.empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {needsAttention.map((proposal) => {
                    const confidence = formatConfidence(proposal.confidence)
                    return (
                      <li key={proposal.id}>
                        <button
                          type="button"
                          onClick={() => router.push(`/backend/caseload/${proposal.id}`)}
                          className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{proposal.agentId}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{proposal.id}</p>
                          </div>
                          {confidence ? (
                            <span className="text-xs text-muted-foreground">{confidence}</span>
                          ) : null}
                          <StatusBadge variant="warning" dot>
                            {t('agent_orchestrator.disposition.pending')}
                          </StatusBadge>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </PageBody>
    </Page>
  )
}
