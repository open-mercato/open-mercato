"use client"

import * as React from 'react'
import { RotateCw, Globe } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type WebSearchHealthStatus = 'ok' | 'degraded' | 'not_configured'

type WebSearchHealth = {
  status: WebSearchHealthStatus
  provider: string
  providerImplId: string | null
  detail: string | null
  webFetch: 'available'
  checkedAt: string
}

// `error` is a client-only state (the health fetch itself failed), kept distinct
// from the provider's own `degraded` verdict so a failed request never reads as a
// healthy provider — or masquerades as the server's diagnosis.
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
    typeof (value as { status?: unknown }).status === 'string'
  )
}

/**
 * Compact diagnostics card for the agent web-search tool. Reads
 * `GET /api/agent_orchestrator/web-search/health` on mount and on demand, and
 * renders the configured provider, its health verdict and the reason detail.
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
        setDetail(call.result.detail)
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
    let cancelled = false
    void (async () => {
      await load()
      if (cancelled) return
    })()
    return () => { cancelled = true }
  }, [load])

  const statusLabel: Record<CardStatus, string> = {
    ok: t('agent_orchestrator.overview.webSearch.status.ok', 'Healthy'),
    degraded: t('agent_orchestrator.overview.webSearch.status.degraded', 'Degraded'),
    not_configured: t('agent_orchestrator.overview.webSearch.status.notConfigured', 'Not configured'),
    error: t('agent_orchestrator.overview.webSearch.status.error', 'Check failed'),
  }
  const variant: StatusBadgeVariant = statusVariant[status]

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
          <StatusBadge variant={variant} dot>{statusLabel[status]}</StatusBadge>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('agent_orchestrator.overview.webSearch.recheck', 'Recheck')}
            disabled={isLoading}
            onClick={() => { void load() }}
          >
            <RotateCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('agent_orchestrator.overview.webSearch.provider', 'Provider')}</dt>
        <dd className="font-mono text-foreground">
          {health?.provider ?? '—'}
          {health?.providerImplId ? <span className="text-muted-foreground"> · {health.providerImplId}</span> : null}
        </dd>
        <dt className="text-muted-foreground">{t('agent_orchestrator.overview.webSearch.webFetch', 'Web fetch')}</dt>
        <dd className="text-foreground">{t('agent_orchestrator.overview.webSearch.webFetchAvailable', 'Available (built-in)')}</dd>
      </dl>

      {detail ? (
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      ) : status === 'ok' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('agent_orchestrator.overview.webSearch.okHint', 'The agent web_search tool is ready.')}
        </p>
      ) : null}
    </div>
  )
}
