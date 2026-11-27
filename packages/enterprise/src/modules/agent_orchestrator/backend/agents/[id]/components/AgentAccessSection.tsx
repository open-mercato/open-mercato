"use client"

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { mapAgentPrincipal, type AgentPrincipalView } from '../../../../components/types'

const IDENTITY_MANAGE_FEATURE = 'agent_orchestrator.identity.manage'

type AgentAccessSectionProps = {
  principal: AgentPrincipalView | null | undefined
  agentId?: string
  onPrincipalChange?: (principal: AgentPrincipalView | null) => void
}

function useCanManageIdentity(enabled: boolean): boolean {
  const [canManage, setCanManage] = React.useState(false)
  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void apiCall<{ granted?: unknown }>(
      '/api/auth/feature-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: [IDENTITY_MANAGE_FEATURE] }),
      },
      { fallback: { granted: [] } },
    ).then((call) => {
      if (cancelled) return
      const granted = Array.isArray(call.result?.granted) ? call.result.granted.map((entry) => String(entry)) : []
      setCanManage(hasAllFeatures([IDENTITY_MANAGE_FEATURE], granted))
    })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return canManage
}

export function AgentAccessSection({ principal, agentId, onPrincipalChange }: AgentAccessSectionProps) {
  const t = useT()
  const syncable = Boolean(agentId) && Boolean(principal?.declared)
  const canManage = useCanManageIdentity(syncable)
  const [syncing, setSyncing] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.agents.access',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  const syncPrincipal = React.useCallback(async () => {
    if (!agentId) return
    setSyncing(true)
    try {
      let next: AgentPrincipalView | null = null
      await runMutation({
        operation: async () => {
          const call = await apiCallOrThrow<{ principal?: unknown }>(
            `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/principal/sync`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
          )
          next = mapAgentPrincipal(call.result?.principal)
        },
        context: { retryLastMutation },
        mutationPayload: { agentId },
      })
      onPrincipalChange?.(next)
      flash(t('agent_orchestrator.agentDetail.access.sync.success'), 'success')
    } catch {
      flash(t('agent_orchestrator.agentDetail.access.sync.error'), 'error')
    } finally {
      setSyncing(false)
    }
  }, [agentId, onPrincipalChange, retryLastMutation, runMutation, t])

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
  const syncAction = syncable && canManage ? (
    <Button type="button" variant="outline" size="sm" onClick={() => void syncPrincipal()} disabled={syncing}>
      {syncing ? <Spinner className="size-4" /> : <RefreshCw className="size-4" aria-hidden />}
      {syncing
        ? t('agent_orchestrator.agentDetail.access.sync.running')
        : t('agent_orchestrator.agentDetail.access.sync.action')}
    </Button>
  ) : null

  return (
    <section className="space-y-2" aria-label={title}>
      <SectionHeader title={title} action={syncAction} />
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
