"use client"

import * as React from 'react'
import { RotateCw, Globe } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type WebSearchHealthStatus = 'ok' | 'degraded' | 'not_configured'

type AdapterHealthRow = {
  id: string
  enabled: boolean
  ready: boolean
  ok: boolean
  detail: string | null
  latencyMs: number | null
}

type WebSearchHealth = {
  status: WebSearchHealthStatus
  source: 'tenant' | 'instance'
  adapters: AdapterHealthRow[]
  problems: Array<{ id: string | null; packageName: string; reason: string }>
  probed?: boolean
  checkedAt: string
}

// `error` is a client-only state (the health fetch itself failed), kept distinct
// from the server's own `degraded` verdict so a failed request never reads as a
// healthy engine — or masquerades as the server's diagnosis.
type CardStatus = WebSearchHealthStatus | 'error'

const statusVariant: StatusMap<CardStatus> = {
  ok: 'success',
  degraded: 'warning',
  not_configured: 'neutral',
  error: 'error',
}

function isHealth(value: unknown): value is WebSearchHealth {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'string' &&
    Array.isArray((value as { adapters?: unknown }).adapters)
  )
}

function adapterVariant(row: AdapterHealthRow): StatusBadgeVariant {
  if (!row.enabled) return 'neutral'
  if (!row.ready) return 'neutral'
  return row.ok ? 'success' : 'warning'
}

/**
 * Per-adapter diagnostics for agent web search. One row per installed adapter:
 * with a racing engine a single verdict is not actionable, but "serp-html
 * blocked, model-native healthy, firecrawl has no key" says what to fix.
 * Purely informational — no mutation — so it needs no optimistic-lock header.
 */
export function WebSearchHealthCard() {
  const t = useT()
  const [health, setHealth] = React.useState<WebSearchHealth | null>(null)
  const [status, setStatus] = React.useState<CardStatus>('not_configured')
  const [detail, setDetail] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const call = await apiCall<unknown>('/api/agent_orchestrator/web-search/health')
      if (call.ok && isHealth(call.result)) {
        setHealth(call.result)
        setStatus(call.result.status)
        setDetail(null)
      } else {
        setHealth(null)
        setStatus('error')
        setDetail(t('agent_orchestrator.overview.webSearch.fetchError', 'Could not read web-search health.'))
      }
    } catch {
      setHealth(null)
      setStatus('error')
      setDetail(t('agent_orchestrator.overview.webSearch.fetchError', 'Could not read web-search health.'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  // The overview must not call the adapters — a metered source bills for that on
  // a page view — so an unprobed `ok` means "configured", never "working". Saying
  // Healthy about something nobody contacted is a guess dressed as a fact.
  const statusLabel: Record<CardStatus, string> = {
    ok:
      health?.probed === false
        ? t('agent_orchestrator.overview.webSearch.status.configured', 'Configured')
        : t('agent_orchestrator.overview.webSearch.status.ok', 'Healthy'),
    degraded: t('agent_orchestrator.overview.webSearch.status.degraded', 'Degraded'),
    not_configured: t('agent_orchestrator.overview.webSearch.status.notConfigured', 'Not configured'),
    error: t('agent_orchestrator.overview.webSearch.status.error', 'Check failed'),
  }

  const enabled = health?.adapters.filter((row) => row.enabled) ?? []
  const disabled = health?.adapters.filter((row) => !row.enabled) ?? []

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Globe className="size-4 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">
            {t('agent_orchestrator.overview.webSearch.title', 'Web search')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge variant={statusVariant[status]} dot>
            {statusLabel[status]}
          </StatusBadge>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('agent_orchestrator.overview.webSearch.recheck', 'Recheck')}
            disabled={isLoading}
            onClick={() => {
              void load()
            }}
          >
            <RotateCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        </div>
      </div>

      {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}

      {enabled.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {enabled.map((row) => (
            <li key={row.id} className="flex items-start gap-2 text-xs">
              <StatusBadge variant={adapterVariant(row)} dot>
                {row.ok
                  ? t('agent_orchestrator.overview.webSearch.adapter.ok', 'OK')
                  : t('agent_orchestrator.overview.webSearch.adapter.problem', 'Problem')}
              </StatusBadge>
              <span className="font-mono text-foreground">{row.id}</span>
              {row.latencyMs !== null ? (
                <span className="text-muted-foreground">{`${row.latencyMs}ms`}</span>
              ) : null}
              {row.detail ? <span className="text-muted-foreground">{row.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {disabled.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('agent_orchestrator.overview.webSearch.disabledAdapters', 'Installed but disabled: {ids}', {
            ids: disabled.map((row) => row.id).join(', '),
          })}
        </p>
      ) : null}

      {health?.problems.length ? (
        <ul className="mt-2 space-y-1">
          {health.problems.map((problem) => (
            <li key={problem.packageName} className="text-xs text-status-warning-text">
              {`${problem.packageName}: ${problem.reason}`}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        {t('agent_orchestrator.overview.webSearch.webFetch', 'Web fetch')}:{' '}
        {t('agent_orchestrator.overview.webSearch.webFetchAvailable', 'Available (built-in)')}
      </p>
    </div>
  )
}

export default WebSearchHealthCard
