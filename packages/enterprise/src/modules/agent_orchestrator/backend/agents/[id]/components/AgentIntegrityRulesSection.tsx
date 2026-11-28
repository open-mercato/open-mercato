"use client"

import * as React from 'react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AgentDetailView } from '../../../../components/types'
import { guardrailKindLabelKey } from '../../../../components/guardrailEvidence'

type AgentIntegrityRulesSectionProps = {
  agent: Pick<AgentDetailView, 'integrityRules' | 'integritySetVersion'>
}

export function AgentIntegrityRulesSection({ agent }: AgentIntegrityRulesSectionProps) {
  const t = useT()
  if (!agent.integrityRules.length) return null
  return (
    <section className="space-y-2">
      <SectionHeader title={t('agent_orchestrator.agentDetail.integrity.title')} count={agent.integrityRules.length} />
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <ul className="space-y-2" aria-label={t('agent_orchestrator.agentDetail.integrity.title')}>
          {agent.integrityRules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-foreground">{rule.id}</span>
              <Tag variant="neutral">{t(guardrailKindLabelKey(rule.kind === 'custom' ? 'custom_integrity' : rule.kind), rule.kind)}</Tag>
              <span className="min-w-0 flex-1" />
              <span className="text-xs text-muted-foreground">
                {rule.onViolation
                  ? t(`agent_orchestrator.agentDetail.integrity.onViolation.${rule.onViolation}`, rule.onViolation)
                  : rule.reviewRoute
                    ? t(`agent_orchestrator.agentDetail.integrity.route.${rule.reviewRoute}`, rule.reviewRoute)
                    : t('agent_orchestrator.agentDetail.integrity.abstainOnly')}
              </span>
            </li>
          ))}
        </ul>
        {agent.integritySetVersion ? (
          <p className="border-t border-border pt-2 text-xs text-muted-foreground">
            {t('agent_orchestrator.traces.detail.guardrailSetVersion')}:{' '}
            <span className="font-mono">{agent.integritySetVersion}</span>
          </p>
        ) : null}
      </div>
    </section>
  )
}
