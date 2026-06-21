"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgent, type AgentView } from '../../components/types'

type AgentsResponse = { items?: Array<Record<string, unknown>> }

export default function AgentsRegistryPage() {
  const t = useT()
  const [agents, setAgents] = React.useState<AgentView[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const call = await apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, {
        fallback: { items: [] },
      })
      if (cancelled) return
      if (!call.ok) {
        setError(t('agent_orchestrator.agents.list.error'))
        setIsLoading(false)
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      setAgents(
        items
          .map((item) => mapAgent(item as Record<string, unknown>))
          .filter((agent): agent is AgentView => !!agent),
      )
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <Page>
      <PageBody className="space-y-5">
        <h1 className="text-lg font-semibold">{t('agent_orchestrator.agents.list.title')}</h1>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.agents.list.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : agents.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.agents.list.empty')}
            description={t('agent_orchestrator.agents.list.emptyDescription')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div key={agent.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium">{agent.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`agent_orchestrator.agents.list.resultKind.${agent.resultKind}`)}
                    </p>
                  </div>
                  <Tag variant="brand" dot>
                    {t('agent_orchestrator.agents.list.marker')}
                  </Tag>
                </div>
                {agent.description ? (
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((tool) => (
                    <Tag key={tool} variant="neutral">
                      {tool}
                    </Tag>
                  ))}
                </div>
                <div className="mt-auto pt-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/backend/playground?agent=${encodeURIComponent(agent.id)}`}>
                      {t('agent_orchestrator.agents.list.openPlayground')}
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
