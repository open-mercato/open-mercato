"use client"

import * as React from 'react'
import { Coins } from 'lucide-react'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatNumber, type AgentDetailView } from '../../../../components/types'
import type { Autonomy } from './workspaceShared'

// Hairline spec-grid cell, matching the trace inspector run-stats grid.
export function StatCell({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <div className="mt-1 flex min-h-8 items-center">{children}</div>
    </div>
  )
}

export function DashCard({
  title,
  actions,
  children,
}: {
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function PendingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  )
}

export function NoticeBanner({
  icon: Icon,
  variant = 'muted',
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  variant?: 'muted' | 'warning'
  children: React.ReactNode
}) {
  if (variant === 'warning') {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-status-warning-border bg-status-warning-bg px-3.5 py-2.5 text-sm text-status-warning-text">
        <Icon className="mt-0.5 size-4 shrink-0 text-status-warning-icon" />
        <span>{children}</span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </div>
  )
}

export function SectionBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted px-6 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

export function ConfigField({ label, pending, children }: { label: string; pending?: boolean; children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {pending ? <span className="text-xs text-muted-foreground">{t('agent_orchestrator.agents.list.pending.backend', 'Needs backend')}</span> : null}
      </div>
      {children}
    </div>
  )
}

// Deliberately disabled (data-honesty spec §3.7): autonomy is a UI heuristic
// with no persistence — a safety-relevant control must never look live while
// doing nothing. Persisting autonomy is the deployment-gating spec's scope.
export function AutonomySegmented({ value }: { value: Autonomy }) {
  const t = useT()
  return (
    <SegmentedControl value={value} disabled aria-label={t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy')}>
      <SegmentedControlItem value="auto">{t('agent_orchestrator.agents.list.autonomy.auto', 'Auto')}</SegmentedControlItem>
      <SegmentedControlItem value="review">{t('agent_orchestrator.agents.list.autonomy.review', 'Review')}</SegmentedControlItem>
      <SegmentedControlItem value="gated">{t('agent_orchestrator.agents.list.autonomy.gated', 'Gated')}</SegmentedControlItem>
    </SegmentedControl>
  )
}

function TokenBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, Math.round(pct)))}%` }} />
    </div>
  )
}

function TokenRow({
  label,
  tokens,
  max,
  locale,
}: {
  label: React.ReactNode
  tokens: number
  max: number
  locale: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">{formatNumber(tokens, locale)}</span>
      </div>
      <div className="mt-1">
        <TokenBar pct={max > 0 ? (tokens / max) * 100 : 0} />
      </div>
    </div>
  )
}

function TokenGroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
}

// Token-usage breakdown of a file-defined agent's construction files. Estimated
// with the shared o200k_base tokenizer — surfaced as guidance, not an exact count.
export function TokenUsageCard({ agent }: { agent: AgentDetailView }) {
  const t = useT()
  const locale = useLocale()
  const usage = agent.tokenUsage
  if (!usage) return null
  const max = Math.max(
    1,
    usage.agent,
    usage.outcome,
    ...usage.skills.map((skill) => skill.tokens),
    ...usage.tools.map((tool) => tool.tokens),
    ...usage.subAgents.map((sub) => sub.tokens),
  )
  return (
    <section className="space-y-2">
      <SectionHeader title={t('agent_orchestrator.agentDetail.tokens.title', 'Token usage')} />
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Coins className="size-3.5 shrink-0" />
            <span className="text-xs">{t('agent_orchestrator.agentDetail.tokens.estimate', 'Estimated with o200k_base — an approximation, not an exact model count.')}</span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-foreground">{formatNumber(usage.total, locale)}</div>
            <div className="text-xs text-muted-foreground">{t('agent_orchestrator.agentDetail.tokens.totalTokens', 'tokens total')}</div>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.core', 'Core files')}</TokenGroupLabel>
            <TokenRow label="AGENT.md" tokens={usage.agent} max={max} locale={locale} />
            <TokenRow label="OUTCOME.md" tokens={usage.outcome} max={max} locale={locale} />
          </div>

          {usage.skills.length ? (
            <div className="space-y-2">
              <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.skills', 'Skills')}</TokenGroupLabel>
              {usage.skills.map((skill) => (
                <div key={skill.id} className="space-y-1">
                  <TokenRow label={<span className="font-mono">{skill.id}</span>} tokens={skill.tokens} max={max} locale={locale} />
                  {skill.files.length ? (
                    <ul className="space-y-0.5 pl-4">
                      {skill.files.map((file) => (
                        <li key={file.path} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{file.path.replace(`skills/${skill.id}/`, '')}</span>
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatNumber(file.tokens, locale)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {usage.tools.length ? (
            <div className="space-y-2">
              <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.tools', 'Tools')}</TokenGroupLabel>
              {usage.tools.map((tool) => (
                <TokenRow key={tool.path} label={<span className="font-mono">{tool.name}</span>} tokens={tool.tokens} max={max} locale={locale} />
              ))}
            </div>
          ) : null}

          {usage.subAgents.length ? (
            <div className="space-y-2">
              <TokenGroupLabel>{t('agent_orchestrator.agentDetail.tokens.subAgents', 'Sub-agents')}</TokenGroupLabel>
              {usage.subAgents.map((sub) => (
                <TokenRow key={sub.id} label={<span className="font-mono">{sub.id}</span>} tokens={sub.tokens} max={max} locale={locale} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
