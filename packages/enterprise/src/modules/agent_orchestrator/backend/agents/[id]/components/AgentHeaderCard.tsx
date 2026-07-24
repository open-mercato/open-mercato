"use client"

import * as React from 'react'
import { CircleCheck, Clock, Coins, Cpu, Hash, Replace, SlidersHorizontal } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  formatCostMinor,
  formatNumber,
  type AgentDetailView,
  type AgentWindowMetricsView,
} from '../../../../components/types'
import { agentAvatarIcon, resolveAgentIcon } from '../../../../components/agentChips'
import { AGENT_ICON_NAMES } from '../../../../data/agentIcons'
import { StatCell, PendingChip } from './workspacePrimitives'
import { statusVariant, titleCase, type AgentMetrics, type Autonomy } from './workspaceShared'

export const ICON_DEFAULT = '__default__'

export type AgentHeaderCardProps = {
  agent: AgentDetailView
  metrics: AgentMetrics
  windowMetrics: AgentWindowMetricsView | null
  autonomy: Autonomy
  savingIcon: boolean
  onIconChange: (value: string) => void
  onConfigure: () => void
}

export function AgentHeaderCard({
  agent,
  metrics,
  windowMetrics,
  autonomy,
  savingIcon,
  onIconChange,
  onConfigure,
}: AgentHeaderCardProps) {
  const t = useT()
  const locale = useLocale()
  const overridePct = metrics.overrideRate == null ? null : Math.round(metrics.overrideRate * 100)
  const overrideGate = overridePct != null && overridePct > 30
  const noData = t('agent_orchestrator.agents.list.pending.noData', 'No data')

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar label={agent.label || agent.id} size="lg" variant="monochrome" icon={agentAvatarIcon(agent.icon, agent.resultKind)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">{agent.label || agent.id}</h1>
              <StatusBadge variant={statusVariant[metrics.status]} dot>
                {t(`agent_orchestrator.agents.list.status.${metrics.status}`, titleCase(metrics.status))}
              </StatusBadge>
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{agent.id}</p>
            <p className="mt-1 text-sm text-muted-foreground">{agent.description || agent.id}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t('agent_orchestrator.agentDetail.icon.label', 'Icon')}</span>
            <Select value={agent.icon ?? ICON_DEFAULT} onValueChange={onIconChange} disabled={savingIcon}>
              <SelectTrigger size="sm" className="w-40" aria-label={t('agent_orchestrator.agentDetail.icon.label', 'Icon')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ICON_DEFAULT}>{t('agent_orchestrator.agentDetail.icon.default', 'Default (by type)')}</SelectItem>
                {AGENT_ICON_NAMES.map((name) => {
                  const Glyph = resolveAgentIcon(name)
                  return (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-2">
                        {Glyph ? <Glyph className="size-4 text-muted-foreground" /> : null}
                        {name}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => flash(t('agent_orchestrator.agentDetail.actions.codeOnly', 'Managed in code for now — UI wiring needs backend.'), 'info')}>
            {t('agent_orchestrator.agentDetail.actions.pause', 'Pause')}
          </Button>
          <Button size="sm" onClick={onConfigure}>
            {t('agent_orchestrator.agentDetail.actions.configure', 'Configure')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-7">
        <StatCell icon={Hash} label={t('agent_orchestrator.agents.list.col.runs', 'Runs')}>
          <span className="text-xl font-bold tabular-nums text-foreground">{formatNumber(metrics.runCount, locale) ?? '0'}</span>
        </StatCell>
        <StatCell icon={CircleCheck} label={t('agent_orchestrator.agents.list.col.evalPass', 'Eval pass')}>
          {windowMetrics?.evalPassRate == null
            ? <PendingChip label={noData} />
            : <span className="text-xl font-bold tabular-nums text-foreground">{Math.round(windowMetrics.evalPassRate * 100)}%</span>}
        </StatCell>
        <StatCell icon={Replace} label={t('agent_orchestrator.agents.list.col.override', 'Override')}>
          {overridePct == null
            ? <PendingChip label={noData} />
            : <span className={`text-xl font-bold tabular-nums ${overrideGate ? 'text-status-error-text' : 'text-foreground'}`}>{overridePct}%</span>}
        </StatCell>
        <StatCell icon={Coins} label={t('agent_orchestrator.agents.list.col.cost', 'Cost / run (est.)')}>
          {(() => {
            const value = formatCostMinor(windowMetrics?.avgCostMinor ?? null, windowMetrics?.currency ?? null)
            return value
              ? <span className="text-xl font-bold tabular-nums text-foreground">{value}</span>
              : <PendingChip label={noData} />
          })()}
        </StatCell>
        <StatCell icon={Clock} label={t('agent_orchestrator.agentDetail.fields.lastActive', 'Last active')}>
          <span className="text-xl font-bold tabular-nums text-foreground">{metrics.lastActive || '—'}</span>
        </StatCell>
        <StatCell icon={Cpu} label={t('agent_orchestrator.agentDetail.fields.model', 'Model')}>
          <span className="truncate font-mono text-sm text-foreground">{agent.defaultModel ?? t('agent_orchestrator.agentDetail.defaultValue')}</span>
        </StatCell>
        <StatCell icon={SlidersHorizontal} label={t('agent_orchestrator.agents.list.col.autonomy', 'Autonomy')}>
          <span className="text-xl font-bold text-foreground">{t(`agent_orchestrator.agents.list.autonomy.${autonomy}`, titleCase(autonomy))}</span>
        </StatCell>
      </div>
    </div>
  )
}
