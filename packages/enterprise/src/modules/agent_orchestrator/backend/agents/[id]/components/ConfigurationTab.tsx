"use client"

import * as React from 'react'
import Link from 'next/link'
import { Brain, Copy } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatNumber, type AgentDetailView, type SkillDetailView } from '../../../../components/types'
import { runtimeDisplayLabel } from '../../../../components/runtimeLabel'
import { TokenUsageCard } from './workspacePrimitives'
import type { RuntimeTokenUsage } from './workspaceShared'

type ConfigurationTabProps = {
  agent: AgentDetailView
  runtimeTokens: RuntimeTokenUsage | null
  onSkillClick: (skill: SkillDetailView) => void
}

export function ConfigurationTab({ agent, runtimeTokens, onSkillClick }: ConfigurationTabProps) {
  const t = useT()
  const locale = useLocale()
  const defaultValue = t('agent_orchestrator.agentDetail.defaultValue', 'Default')

  const copyInstructions = () => {
    if (!agent.instructions || typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(agent.instructions).then(
      () => flash(t('agent_orchestrator.agentDetail.instructionsCopied', 'Instructions copied to clipboard.'), 'success'),
      () => flash(t('agent_orchestrator.agentDetail.copyFailed', 'Could not copy to clipboard.'), 'error'),
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader title={t('agent_orchestrator.agentDetail.fields.instructions', 'Instructions')} />
            <Button type="button" variant="outline" size="sm" disabled={!agent.instructions} onClick={copyInstructions}>
              <Copy className="mr-1.5 size-3.5" />
              {t('agent_orchestrator.agentDetail.copy', 'Copy')}
            </Button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
            {agent.instructions || t('agent_orchestrator.agentDetail.defaultValue')}
          </pre>
        </section>

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.tools', 'Tools')} />
          {agent.tools.length ? (
            <div className="flex flex-wrap gap-1">
              {agent.tools.map((tool) => <Tag key={tool} variant="neutral">{tool}</Tag>)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.noTools')}</p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.config.runtime', 'Runtime')} />
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm">
            <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.fields.provider', 'Provider')}</dt>
            <dd className="font-mono text-foreground">{agent.defaultProvider ?? defaultValue}</dd>
            <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.fields.model', 'Model')}</dt>
            <dd className="font-mono text-foreground">{agent.defaultModel ?? defaultValue}</dd>
            <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.fields.maxSteps', 'Max steps')}</dt>
            <dd className="tabular-nums text-foreground">{agent.loopMaxSteps != null ? String(agent.loopMaxSteps) : defaultValue}</dd>
            <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.config.runtimeKind', 'Runtime')}</dt>
            <dd className="text-foreground">{runtimeDisplayLabel(t, agent.runtime, agent.runtimeMode)}</dd>
            <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.config.resultKind', 'Result kind')}</dt>
            <dd className="text-foreground">{agent.resultKind}</dd>
            {/* The DECLARED type is an authoring fact and sits beside — never
                instead of — the runtime result kind; the two may legitimately
                disagree. */}
            <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.config.agentType', 'Agent type')}</dt>
            <dd className="text-foreground">
              {agent.agentType
                ? t(`agent_orchestrator.agents.list.agentType.${agent.agentType}`)
                : t('agent_orchestrator.agents.list.agentType.undeclared', 'Undeclared')}
            </dd>
          </dl>
        </section>

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.allowedActions', 'Allowed actions')} />
          {/* `null` = no narrowing declared (the whole catalogue); an EMPTY list =
              everything declared fell outside the catalogue and was dropped. The
              two must not read the same — one is permissive, the other forbids
              every effect. */}
          {agent.allowedActions == null ? (
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              {t('agent_orchestrator.agentDetail.allowedActions.catalogue')}
            </p>
          ) : agent.allowedActions.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-status-warning-text">
              {t('agent_orchestrator.agentDetail.allowedActions.none')}
            </p>
          ) : (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {t('agent_orchestrator.agentDetail.allowedActions.narrowed', undefined, {
                  count: agent.allowedActions.length,
                })}
              </p>
              <div className="flex flex-wrap gap-1">
                {agent.allowedActions.map((action) => (
                  <Tag key={action} variant="neutral">{action}</Tag>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.tokens.runtimeTitle', 'Token usage')} />
          {runtimeTokens ? (
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm">
              <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.tokens.perRun', 'Per run (avg)')}</dt>
              <dd className="tabular-nums text-foreground">
                {formatNumber(runtimeTokens.inputAvg, locale)} {t('agent_orchestrator.agentDetail.tokens.in', 'in')} · {formatNumber(runtimeTokens.outputAvg, locale)} {t('agent_orchestrator.agentDetail.tokens.out', 'out')}
              </dd>
              <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.tokens.recentTotal', 'Recent {count} runs', { count: runtimeTokens.count })}</dt>
              <dd className="tabular-nums text-foreground">
                {formatNumber(runtimeTokens.inputTotal, locale)} {t('agent_orchestrator.agentDetail.tokens.in', 'in')} · {formatNumber(runtimeTokens.outputTotal, locale)} {t('agent_orchestrator.agentDetail.tokens.out', 'out')}
              </dd>
            </dl>
          ) : (
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.tokens.none', 'No runs have reported token usage yet.')}</p>
          )}
        </section>

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.skills', 'Skills')} />
          {agent.skillDetails.length ? (
            <ul className="space-y-2">
              {agent.skillDetails.map((skill) => (
                <li key={skill.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSkillClick(skill)}
                    className="h-auto w-full items-start justify-start gap-3 rounded-lg border border-border bg-card p-3 text-left font-normal hover:bg-accent/30"
                    aria-label={t('agent_orchestrator.agentDetail.viewSkill', undefined, { skill: skill.label })}
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Brain className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-sm font-medium text-foreground">{skill.id}</p>
                        <span className="text-xs text-muted-foreground">{skill.label}</span>
                      </div>
                      {skill.description ? <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p> : null}
                    </div>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.noSkills')}</p>
          )}
        </section>

        {agent.subAgents.length ? (
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.agentDetail.fields.subAgents')} />
            <div className="flex flex-wrap gap-1">
              {agent.subAgents.map((subId) => (
                <Button key={subId} asChild variant="outline" size="sm">
                  <Link href={`/backend/agents/${encodeURIComponent(subId)}`}>{subId}</Link>
                </Button>
              ))}
            </div>
          </section>
        ) : null}

        {agent.runtime === 'business-harness' && agent.tokenUsage ? (
          <TokenUsageCard agent={agent} />
        ) : null}
      </div>
    </div>
  )
}
