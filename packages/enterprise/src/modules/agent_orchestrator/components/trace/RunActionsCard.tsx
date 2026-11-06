"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { InspectorCard } from './InspectorCard'
import { formatDateTime } from '../types'

export type RunActionRow = {
  id: string
  commandId: string
  actionLabel: string | null
  resourceKind: string | null
  resourceId: string | null
  actorUserId: string | null
  onBehalfOfUserId: string | null
  sourceKey: string | null
  correlation: Record<string, string>
  createdAt: string
}

type RunActionsResponse = { items: RunActionRow[]; total: number }

type LoadState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'ready'; items: RunActionRow[]; total: number }

const RUN_ACTIONS_PAGE_SIZE = 50

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

export function RunActionsCard({ runId }: { runId: string }) {
  const t = useT()
  const locale = useLocale()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })

  React.useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void (async () => {
      const call = await apiCall<RunActionsResponse>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/actions?pageSize=${RUN_ACTIONS_PAGE_SIZE}`,
      )
      if (!active) return
      if (!call.ok || !call.result) {
        setState({ status: 'hidden' })
        return
      }
      setState({ status: 'ready', items: call.result.items ?? [], total: call.result.total ?? 0 })
    })()
    return () => {
      active = false
    }
  }, [runId])

  if (state.status === 'hidden') return null

  const hint = state.status === 'ready' && state.total > state.items.length
    ? t('agent_orchestrator.traces.actions.showing', undefined, { shown: state.items.length, total: state.total })
    : undefined

  return (
    <InspectorCard title={t('agent_orchestrator.traces.actions.title')} hint={hint}>
      {state.status === 'loading' ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.actions.loading')}</p>
      ) : state.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.actions.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {state.items.map((row) => (
            <li key={row.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {row.actionLabel ?? row.commandId}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(row.createdAt, locale)}</span>
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">{row.commandId}</p>
              <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
                {row.resourceKind ? (
                  <div className="flex min-w-0 gap-1">
                    <dt className="text-muted-foreground">{t('agent_orchestrator.traces.actions.columns.resource')}</dt>
                    <dd className="truncate font-mono text-foreground">
                      {row.resourceKind}{row.resourceId ? ` · ${shortId(row.resourceId)}` : ''}
                    </dd>
                  </div>
                ) : null}
                {row.actorUserId ? (
                  <div className="flex min-w-0 gap-1">
                    <dt className="text-muted-foreground">{t('agent_orchestrator.traces.actions.columns.actor')}</dt>
                    <dd className="truncate font-mono text-foreground" title={row.actorUserId}>{shortId(row.actorUserId)}</dd>
                  </div>
                ) : null}
                {row.onBehalfOfUserId ? (
                  <div className="flex min-w-0 gap-1">
                    <dt className="text-muted-foreground">{t('agent_orchestrator.traces.actions.columns.onBehalfOf')}</dt>
                    <dd className="truncate font-mono text-foreground" title={row.onBehalfOfUserId}>{shortId(row.onBehalfOfUserId)}</dd>
                  </div>
                ) : null}
                {row.correlation.proposalId ? (
                  <div className="flex min-w-0 gap-1">
                    <dt className="text-muted-foreground">{t('agent_orchestrator.traces.actions.columns.proposal')}</dt>
                    <dd className="truncate font-mono text-foreground" title={row.correlation.proposalId}>{shortId(row.correlation.proposalId)}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </InspectorCard>
  )
}
