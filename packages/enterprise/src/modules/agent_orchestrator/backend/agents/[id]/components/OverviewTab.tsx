"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, Inbox, TriangleAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DashCard, NoticeBanner } from './workspacePrimitives'
import { runVolumeByDay, type AgentMetrics, type WorkspaceTab } from './workspaceShared'

type EvalSection = 'assertions' | 'cases' | 'runs'

type OverviewTabProps = {
  agentId: string
  metrics: AgentMetrics
  runs: Array<Record<string, unknown>>
  active: boolean
  onNavigate: (tab: WorkspaceTab, section?: EvalSection) => void
}

type AttentionState = {
  draftCases: number | null
  lastFailedRun: { id: string; passScore: number | null } | null
  loaded: boolean
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function OverviewTab({ agentId, metrics, runs, active, onNavigate }: OverviewTabProps) {
  const t = useT()
  const router = useRouter()
  const [attention, setAttention] = React.useState<AttentionState>({ draftCases: null, lastFailedRun: null, loaded: false })

  React.useEffect(() => {
    if (!active || !agentId) return
    let cancelled = false
    async function load() {
      const id = encodeURIComponent(agentId)
      const [casesCall, runsCall] = await Promise.all([
        apiCall<{ total?: number; items?: unknown[] }>(
          `/api/agent_orchestrator/eval-cases?agentDefinitionId=${id}&status=draft&pageSize=1`,
          undefined,
          { fallback: { total: 0, items: [] } },
        ),
        apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/agent_orchestrator/eval-runs?agentDefinitionId=${id}&pageSize=10`,
          undefined,
          { fallback: { items: [] } },
        ),
      ])
      if (cancelled) return
      const draftCases = casesCall.ok
        ? asNumber(casesCall.result?.total) ?? (Array.isArray(casesCall.result?.items) ? casesCall.result.items.length : 0)
        : null
      let lastFailedRun: AttentionState['lastFailedRun'] = null
      if (runsCall.ok && Array.isArray(runsCall.result?.items)) {
        const failed = runsCall.result.items.find((item) => {
          const outcome = asString(item.outcome)
          return outcome === 'failed' || outcome === 'advisory'
        })
        if (failed) {
          const id2 = asString(failed.id)
          if (id2) lastFailedRun = { id: id2, passScore: asNumber(failed.pass_score ?? failed.passScore) }
        }
      }
      setAttention({ draftCases, lastFailedRun, loaded: true })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [active, agentId])

  const overridePct = metrics.overrideRate == null ? null : Math.round(metrics.overrideRate * 100)
  const overrideGate = overridePct != null && overridePct > 30

  const items: React.ReactNode[] = []
  const draftCases = attention.draftCases ?? 0
  if (draftCases > 0) {
    items.push(
      <AttentionRow
        key="draft-cases"
        tone="warning"
        icon={FileText}
        title={t('agent_orchestrator.agentDetail.attention.draftCases.title', '{count} draft eval cases', { count: draftCases })}
        body={t('agent_orchestrator.agentDetail.attention.draftCases.body', 'Corrections drafted them — approve to grow the regression set.')}
        actionLabel={t('agent_orchestrator.agentDetail.attention.review', 'Review')}
        onAction={() => onNavigate('evaluation', 'cases')}
      />,
    )
  }
  if (metrics.pending > 0) {
    items.push(
      <AttentionRow
        key="pending-proposals"
        tone="info"
        icon={Inbox}
        title={t('agent_orchestrator.agentDetail.attention.pending.title', '{count} proposals waiting', { count: metrics.pending })}
        body={t('agent_orchestrator.agentDetail.attention.pending.body', 'Parked below the auto-approve threshold for a human decision.')}
        actionLabel={t('agent_orchestrator.agentDetail.attention.openCaseload', 'Open caseload')}
        onAction={() => router.push('/backend/caseload')}
      />,
    )
  }
  if (attention.lastFailedRun) {
    items.push(
      <AttentionRow
        key="failed-run"
        tone="error"
        icon={TriangleAlert}
        title={t('agent_orchestrator.agentDetail.attention.failedRun.title', 'Last evaluation did not pass')}
        body={attention.lastFailedRun.passScore == null
          ? t('agent_orchestrator.agentDetail.attention.failedRun.bodyNoScore', 'A gate assertion regressed against the baseline.')
          : t('agent_orchestrator.agentDetail.attention.failedRun.body', 'Pass score {pct}% — a gate assertion regressed against the baseline.', { pct: Math.round(attention.lastFailedRun.passScore * 100) })}
        actionLabel={t('agent_orchestrator.agentDetail.attention.viewRun', 'View run')}
        onAction={() => onNavigate('evaluation', 'runs')}
      />,
    )
  }

  const spark = runVolumeByDay(runs, 14, Date.now())
  const sparkMax = Math.max(1, ...spark)

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        {overrideGate ? (
          <NoticeBanner icon={TriangleAlert} variant="warning">
            {t('agent_orchestrator.agentDetail.autonomy.gateWarning', 'Override {pct}% is above the 30% gate — consider Gated.', { pct: overridePct })}
          </NoticeBanner>
        ) : null}
        <DashCard title={t('agent_orchestrator.agentDetail.runVolume.title', 'Run volume · last 14 days')}>
          {metrics.runCount === 0 ? (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.recent.empty', 'No runs yet for this agent.')}</p>
          ) : (
            <div className="flex h-24 items-end gap-1" role="img" aria-label={t('agent_orchestrator.agentDetail.runVolume.title', 'Run volume · last 14 days')}>
              {spark.map((count, index) => (
                <div
                  key={index}
                  className={`flex-1 rounded-t ${index >= spark.length - 4 ? 'bg-primary/70' : 'bg-primary/25'}`}
                  style={{ height: `${Math.max(4, (count / sparkMax) * 100)}%` }}
                  title={String(count)}
                />
              ))}
            </div>
          )}
        </DashCard>
      </div>

      <DashCard
        title={t('agent_orchestrator.agentDetail.attention.title', 'Needs your attention')}
        actions={items.length > 0 ? <StatusBadge variant="error" dot>{String(items.length)}</StatusBadge> : null}
      >
        {!attention.loaded ? (
          <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.attention.loading', 'Checking…')}</p>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-status-success-icon" />
            {t('agent_orchestrator.agentDetail.attention.clear', 'Nothing needs you right now.')}
          </div>
        ) : (
          <div className="space-y-1">{items}</div>
        )}
      </DashCard>
    </div>
  )
}

function AttentionRow({
  tone,
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: 'warning' | 'info' | 'error'
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  const toneClass =
    tone === 'error'
      ? 'bg-status-error-bg text-status-error-icon'
      : tone === 'warning'
        ? 'bg-status-warning-bg text-status-warning-icon'
        : 'bg-status-info-bg text-status-info-icon'
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-0">
      <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
      <Button variant="outline" size="2xs" onClick={onAction}>{actionLabel}</Button>
    </div>
  )
}
