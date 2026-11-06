"use client"

import * as React from 'react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AgentPrincipalView } from '../../../../components/types'

type AgentAccessSectionProps = {
  principal: AgentPrincipalView | null | undefined
}

export function AgentAccessSection({ principal }: AgentAccessSectionProps) {
  const t = useT()
  if (principal === undefined) return null
  const title = t('agent_orchestrator.agentDetail.access.title')

  if (principal === null) {
    return (
      <section className="space-y-2" aria-label={title}>
        <SectionHeader title={title} />
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {t('agent_orchestrator.agentDetail.access.none')}
        </p>
      </section>
    )
  }

  const roleFeatures = principal.roleFeatures ?? []

  return (
    <section className="space-y-2" aria-label={title}>
      <SectionHeader title={title} />
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={principal.provisioned ? 'success' : 'warning'} dot>
            {principal.provisioned
              ? t('agent_orchestrator.agentDetail.access.provisioned')
              : t('agent_orchestrator.agentDetail.access.notProvisioned')}
          </StatusBadge>
          {principal.provisioned ? (
            <StatusBadge variant={principal.enabled ? 'success' : 'neutral'} dot>
              {principal.enabled
                ? t('agent_orchestrator.agentDetail.access.enabled')
                : t('agent_orchestrator.agentDetail.access.disabled')}
            </StatusBadge>
          ) : null}
        </div>
        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.access.toolAcl')}</dt>
          <dd className="text-foreground">{t(`agent_orchestrator.agentDetail.access.toolAclMode.${principal.toolAcl}`)}</dd>
          <dt className="text-muted-foreground">{t('agent_orchestrator.agentDetail.access.required')}</dt>
          <dd className="text-foreground">
            {principal.required
              ? t('agent_orchestrator.agentDetail.access.requiredYes')
              : t('agent_orchestrator.agentDetail.access.requiredNo')}
          </dd>
        </dl>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{t('agent_orchestrator.agentDetail.access.features')}</p>
          {!principal.declared ? (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.access.undeclared')}</p>
          ) : roleFeatures.length ? (
            <div className="flex flex-wrap gap-1">
              {roleFeatures.map((feature) => (
                <Tag key={feature} variant="neutral">
                  <span className="font-mono">{feature}</span>
                </Tag>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.access.noFeatures')}</p>
          )}
        </div>
      </div>
    </section>
  )
}
