"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Metrics = {
  governance: {
    runsTotal: number
    checkpointRate: number
    pendingApprovals: number
    interventionLatencyMs: number
  }
  memory: {
    decisionsTotal: number
    traceCompletenessRate: number
    precedentUsefulnessRate: number
  }
  operations: {
    failedRuns24h: number
    telemetryRepairSignals24h: number
    checkpointVolume24h: number
    alertRouting: {
      severity: 'none' | 'low' | 'medium' | 'high'
      route: 'none' | 'governance_admins' | 'operators'
      digestRecommended: boolean
      reasons: string[]
    }
  }
  learning: {
    skillsTotal: number
    promotedSkills30d: number
    skillGuidanceImpact30d: {
      terminalRunsWithSkills: number
      terminalRunsWithoutSkills: number
      successRateWithSkills: number
      successRateWithoutSkills: number
      successRateDelta: number
    }
  }
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function formatSignedPercent(value: number): string {
  const normalized = Math.max(-1, Math.min(1, value))
  const sign = normalized > 0 ? '+' : ''
  return `${sign}${Math.round(normalized * 100)}%`
}

function formatDuration(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs <= 0) return '0m'
  const minutes = Math.round(valueMs / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return `${hours}h`
}

export default function AgentGovernanceDashboardPage() {
  const t = useT()
  const [metrics, setMetrics] = React.useState<Metrics | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiCall<Metrics>('/api/agent_governance/metrics')
        if (!response.ok || !response.result) {
          throw new Error(t('agent_governance.dashboard.loadError', 'Failed to load governance metrics.'))
        }
        if (!cancelled) {
          setMetrics(response.result)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : t('agent_governance.dashboard.loadError', 'Failed to load governance metrics.'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{t('agent_governance.dashboard.title', 'Agent Governance')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('agent_governance.dashboard.subtitle', 'Decision telemetry, run control, approvals, and skill memory in one place.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/backend/agent-governance/runs">{t('agent_governance.nav.runs', 'Runs')}</Link></Button>
              <Button asChild variant="outline"><Link href="/backend/agent-governance/approvals">{t('agent_governance.nav.approvals', 'Approvals')}</Link></Button>
              <Button asChild variant="outline"><Link href="/backend/agent-governance/skills">{t('agent_governance.nav.skills', 'Skills')}</Link></Button>
            </div>
          </div>

          {isLoading ? <LoadingMessage message={t('agent_governance.dashboard.loading', 'Loading dashboard...')} /> : null}
          {!isLoading && error ? <ErrorMessage message={error} /> : null}

          {!isLoading && !error && metrics ? (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label={t('agent_governance.metrics.runsTotal', 'Total runs')} value={String(metrics.governance.runsTotal)} />
                <MetricCard label={t('agent_governance.metrics.pendingApprovals', 'Pending approvals')} value={String(metrics.governance.pendingApprovals)} />
                <MetricCard label={t('agent_governance.metrics.traceCompleteness', 'Trace completeness')} value={formatPercent(metrics.memory.traceCompletenessRate)} />
                <MetricCard label={t('agent_governance.metrics.interventionLatency', 'Intervention latency')} value={formatDuration(metrics.governance.interventionLatencyMs)} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <MetricCard label={t('agent_governance.metrics.precedentUsefulness', 'Precedent usefulness')} value={formatPercent(metrics.memory.precedentUsefulnessRate)} />
                <MetricCard label={t('agent_governance.metrics.failedRuns24h', 'Failed runs (24h)')} value={String(metrics.operations.failedRuns24h)} />
                <MetricCard label={t('agent_governance.metrics.telemetryRepair24h', 'Telemetry repair signals (24h)')} value={String(metrics.operations.telemetryRepairSignals24h)} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <MetricCard label={t('agent_governance.metrics.decisionsTotal', 'Decision events')} value={String(metrics.memory.decisionsTotal)} />
                <MetricCard label={t('agent_governance.metrics.skillsTotal', 'Skills total')} value={String(metrics.learning.skillsTotal)} />
                <MetricCard label={t('agent_governance.metrics.skillsPromoted30d', 'Skills promoted (30d)')} value={String(metrics.learning.promotedSkills30d)} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <MetricCard
                  label={t('agent_governance.metrics.skillDelta30d', 'Skill success delta (30d)')}
                  value={formatSignedPercent(metrics.learning.skillGuidanceImpact30d.successRateDelta)}
                />
                <MetricCard
                  label={t('agent_governance.metrics.alertSeverity', 'Alert severity')}
                  value={`${metrics.operations.alertRouting.severity} · ${metrics.operations.alertRouting.route}`}
                />
                <MetricCard
                  label={t('agent_governance.metrics.alertMode', 'Alert mode')}
                  value={metrics.operations.alertRouting.digestRecommended ? 'Digest' : 'Immediate'}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><Link href="/backend/agent-governance/policies">{t('agent_governance.nav.policies', 'Policies')}</Link></Button>
                <Button asChild variant="outline"><Link href="/backend/agent-governance/risk-bands">{t('agent_governance.nav.riskBands', 'Risk bands')}</Link></Button>
                <Button asChild variant="outline"><Link href="/backend/agent-governance/playbooks">{t('agent_governance.nav.playbooks', 'Playbooks')}</Link></Button>
              </div>
            </>
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}
