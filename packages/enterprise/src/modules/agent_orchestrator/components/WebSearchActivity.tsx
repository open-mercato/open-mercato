"use client"

/**
 * Live per-adapter narration of an agent's web searches.
 *
 * Subscribes to `agent_orchestrator.web_search.progress`, which the tools emit
 * from the MCP process and pg NOTIFY carries to the browser. The operator's
 * question is "which source is answering, and how is it doing" — so this shows
 * one row per adapter holding its latest state, rather than an append-only log
 * of every transition. Engine-level steps carry no adapter and describe the run
 * as a whole, so they drive the caption instead of adding nameless rows.
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
  /** Cap on adapter rows so a long run cannot grow the DOM without bound. */
  maxSteps?: number
  className?: string
}

type AdapterRow = {
  adapterId: string
  event: string
  detail: string | null
  latencyMs: number | null
  resultCount: number | null
  seq: number
}

type ActivityState = {
  query: string
  stage: string | null
  adapters: readonly AdapterRow[]
}

const EMPTY_STATE: ActivityState = { query: '', stage: null, adapters: [] }

const VARIANTS: Readonly<Record<string, StatusBadgeVariant>> = {
  started: 'info',
  queued: 'neutral',
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

/** Engine-level phases, in the order the scheduler reaches them. */
const STAGE_BY_PHASE: Readonly<Record<string, string>> = {
  fetch: 'reading',
  fusion: 'merging',
  done: 'done',
}

const FAILED_EVENTS = new Set(['blocked', 'timeout', 'error', 'unavailable', 'empty'])

const DEFAULT_MAX_STEPS = 40

export function WebSearchActivity({ runId, maxSteps = DEFAULT_MAX_STEPS, className }: WebSearchActivityProps) {
  const t = useT()
  const [state, setState] = React.useState<ActivityState>(EMPTY_STATE)

  useAppEvent('agent_orchestrator.web_search.progress', (event) => {
    const payload = event.payload as WebSearchProgressEvent | undefined
    if (!payload?.event) return
    if (runId && payload.runId && payload.runId !== runId) return

    setState((current) => {
      const query = payload.query ?? current.query
      const adapterId = payload.adapterId ?? null

      if (!adapterId) {
        const stage = payload.phase ? (STAGE_BY_PHASE[payload.phase] ?? current.stage) : current.stage
        return { ...current, query, stage }
      }

      const row: AdapterRow = {
        adapterId,
        event: payload.event ?? 'started',
        detail: payload.detail ?? null,
        latencyMs: payload.latencyMs ?? null,
        resultCount: payload.resultCount ?? null,
        seq: payload.sequence ?? current.adapters.length,
      }
      const existing = current.adapters.findIndex((entry) => entry.adapterId === adapterId)
      if (existing === -1) {
        return { ...current, query, adapters: [...current.adapters, row].slice(-maxSteps) }
      }
      // An adapter reports several times (started, then its outcome). Keeping the
      // row in place means the list stays a stable roster instead of reordering
      // under the operator every time a source progresses.
      const adapters = [...current.adapters]
      adapters[existing] = row
      return { ...current, query, adapters }
    })
  })

  if (state.adapters.length === 0 && state.stage === null) return null

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">
            {t('agent_orchestrator.webSearch.activity.title', 'Web search')}
          </span>
          {state.stage ? (
            <span className="text-xs text-muted-foreground">
              {t(`agent_orchestrator.webSearch.activity.stage.${state.stage}`, state.stage)}
            </span>
          ) : null}
        </div>

        <div className="space-y-2 p-4">
          {state.query ? (
            <p className="truncate text-sm text-muted-foreground" title={state.query}>
              {state.query}
            </p>
          ) : null}

          {state.adapters.length > 0 ? (
            <ul className="space-y-1">
              {state.adapters.map((row) => (
                <li key={row.adapterId} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm">
                    <StatusBadge variant={VARIANTS[row.event] ?? 'neutral'}>
                      {t(`agent_orchestrator.webSearch.activity.event.${row.event}`, row.event)}
                    </StatusBadge>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.adapterId}</span>
                    {row.resultCount !== null ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t('agent_orchestrator.webSearch.activity.results', '{count} results', {
                          count: String(row.resultCount),
                        })}
                      </span>
                    ) : null}
                    {row.latencyMs !== null ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{`${row.latencyMs}ms`}</span>
                    ) : null}
                  </div>
                  {/* Only failures carry a reason worth the extra line; a healthy
                      adapter's detail just repeats what the badge already says. */}
                  {row.detail && FAILED_EVENTS.has(row.event) ? (
                    <p className="pl-1 text-xs text-muted-foreground">{row.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default WebSearchActivity
