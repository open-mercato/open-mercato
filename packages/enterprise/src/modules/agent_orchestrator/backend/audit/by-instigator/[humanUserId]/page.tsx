"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../../components/types'

type InstigatorEntry = {
  id: string
  commandId: string | null
  actionType: string | null
  actionLabel: string | null
  sourceKey: string | null
  resourceKind: string | null
  resourceId: string | null
  actorUserId: string | null
  onBehalfOfUserId: string | null
  createdAt: string | null
  via: 'direct' | 'via_agent'
}

type InstigatorResponse = {
  humanUserId: string
  items: InstigatorEntry[]
  total: number
}

export default function InstigatorAuditChainPage({ params }: { params?: { humanUserId?: string } }) {
  const t = useT()
  const locale = useLocale()
  const humanUserId = params?.humanUserId ?? ''
  const [data, setData] = React.useState<InstigatorResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const call = await apiCall<InstigatorResponse>(
        `/api/agent_orchestrator/audit/by-instigator/${encodeURIComponent(humanUserId)}`,
        undefined,
        { fallback: { humanUserId, items: [], total: 0 } },
      )
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.identity.audit.error'))
        setIsLoading(false)
        return
      }
      setData(call.result ?? { humanUserId, items: [], total: 0 })
      setIsLoading(false)
    }
    if (humanUserId) void load()
    return () => {
      cancelled = true
    }
  }, [t, humanUserId])

  return (
    <Page>
      <PageBody>
        <section className="space-y-4">
          <SectionHeader title={t('agent_orchestrator.identity.audit.title')} />
          <p className="text-sm text-muted-foreground">
            {t('agent_orchestrator.identity.audit.description')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('agent_orchestrator.identity.audit.instigator')}: <span className="font-mono">{humanUserId}</span>
          </p>

          {isLoading ? (
            <LoadingMessage label={t('agent_orchestrator.identity.audit.title')} />
          ) : error ? (
            <ErrorMessage label={error} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState title={t('agent_orchestrator.identity.audit.empty')} />
          ) : (
            <ul className="rounded-md border border-border">
              {data.items.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground">
                      {entry.actionLabel ?? entry.commandId ?? entry.actionType ?? '—'}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt, locale) ?? entry.createdAt ?? '—'}
                      <StatusBadge variant={entry.via === 'via_agent' ? 'warning' : 'neutral'}>
                        {entry.via === 'via_agent'
                          ? t('agent_orchestrator.identity.audit.viaAgent')
                          : t('agent_orchestrator.identity.audit.direct')}
                      </StatusBadge>
                    </span>
                  </div>
                  {entry.via === 'via_agent' ? (
                    <p className="text-xs text-muted-foreground">
                      {t('agent_orchestrator.identity.audit.chain', {
                        agent: entry.actorUserId ?? '—',
                        human: entry.onBehalfOfUserId ?? '—',
                      })}
                    </p>
                  ) : null}
                  {entry.resourceKind ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {entry.resourceKind}
                      {entry.resourceId ? ` · ${entry.resourceId}` : ''}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </Page>
  )
}
