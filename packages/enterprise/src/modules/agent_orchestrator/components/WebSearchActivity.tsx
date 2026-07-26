"use client"

/**
 * Live per-adapter narration of an agent's web searches.
 *
 * Subscribes to `agent_orchestrator.web_search.progress`, which the tools emit
 * from the MCP process and pg NOTIFY carries to the browser. Steps arrive one
 * per adapter transition, so the operator sees which source was tried, whether
 * it answered or was blocked, and why — rather than a spinner.
 */

import * as React from 'react'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type WebSearchProgressEvent = {
  runId?: string | null
  agentId?: string | null
  sequence?: number
  phase?: string
  event?: string
  adapterId?: string | null
  detail?: string | null
  latencyMs?: number | null
  resultCount?: number | null
  query?: string
}

export type WebSearchActivityProps = {
  /** Only show steps for this run; omit to follow whatever is running. */
  runId?: string | null
  /** Newest-first cap so a long run cannot grow the DOM without bound. */
  maxSteps?: number
  className?: string
}

type ActivityRow = {
  key: string
  adapterId: string
  event: string
  detail: string | null
  latencyMs: number | null
  resultCount: number | null
  query: string
}

const VARIANTS: Readonly<Record<string, StatusBadgeVariant>> = {
  started: 'info',
  ok: 'success',
  cached: 'success',
  completed: 'success',
  empty: 'neutral',
  unavailable: 'neutral',
  cancelled: 'neutral',
  blocked: 'warning',
  escalated: 'warning',
  timeout: 'warning',
  error: 'error',
}

const DEFAULT_MAX_STEPS = 40

export function WebSearchActivity({ runId, maxSteps = DEFAULT_MAX_STEPS, className }: WebSearchActivityProps) {
  const t = useT()
  const [rows, setRows] = React.useState<ActivityRow[]>([])

  useAppEvent('agent_orchestrator.web_search.progress', (event) => {
    const payload = event.payload as WebSearchProgressEvent | undefined
    if (!payload?.event) return
    if (runId && payload.runId && payload.runId !== runId) return

    setRows((current) => {
      const row: ActivityRow = {
        key: `${payload.runId ?? 'run'}:${payload.sequence ?? current.length}`,
        adapterId: payload.adapterId ?? t('agent_orchestrator.webSearch.activity.engine', 'engine'),
        event: payload.event ?? 'started',
        detail: payload.detail ?? null,
        latencyMs: payload.latencyMs ?? null,
        resultCount: payload.resultCount ?? null,
        query: payload.query ?? '',
      }
      // Re-keyed rather than appended blindly: a retried step reuses its sequence.
      const next = current.filter((entry) => entry.key !== row.key)
      next.push(row)
      return next.slice(-maxSteps)
    })
  })

  if (rows.length === 0) return null

  return (
    <div className={className}>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-sm">
            <StatusBadge variant={VARIANTS[row.event] ?? 'neutral'}>
              {t(`agent_orchestrator.webSearch.activity.event.${row.event}`, row.event)}
            </StatusBadge>
            <span className="font-medium">{row.adapterId}</span>
            {row.resultCount !== null ? (
              <span className="text-muted-foreground">
                {t('agent_orchestrator.webSearch.activity.results', '{count} results', {
                  count: String(row.resultCount),
                })}
              </span>
            ) : null}
            {row.latencyMs !== null ? (
              <span className="text-muted-foreground">{`${row.latencyMs}ms`}</span>
            ) : null}
            {row.detail ? <span className="text-muted-foreground truncate">{row.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default WebSearchActivity
