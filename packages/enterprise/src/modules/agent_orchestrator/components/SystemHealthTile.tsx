"use client"

import * as React from 'react'
import { Activity } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverTrigger, PopoverContent } from '@open-mercato/ui/primitives/popover'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  deriveRuntimeIndicators,
  deriveWebSearchIndicator,
  isAiRuntimeHealthPayload,
  isWebSearchHealthPayload,
  rollupHealth,
  type AiRuntimeHealthPayload,
  type HealthIndicator,
  type HealthIndicatorId,
  type HealthState,
  type WebSearchHealthPayload,
} from '../lib/systemHealth'
import { OPTIONAL_REQUEST_INIT } from './optionalRequest'
import { SystemHealthPanel } from './health/SystemHealthPanel'
import { HealthStateBadge } from './health/HealthStateBadge'
import { runtimeDisplayLabel } from './runtimeLabel'

const INDICATOR_LABEL_KEY: Record<HealthIndicatorId, string> = {
  webSearch: 'agent_orchestrator.overview.health.webSearch',
  harness: 'agent_orchestrator.overview.health.harness',
  capability: 'agent_orchestrator.overview.health.capability',
}

const STATE_LABEL_KEY: Record<HealthState, string> = {
  ok: 'agent_orchestrator.health.state.ok',
  degraded: 'agent_orchestrator.health.state.degraded',
  down: 'agent_orchestrator.health.state.down',
  unknown: 'agent_orchestrator.health.state.unknown',
  error: 'agent_orchestrator.health.state.error',
}

const DOT_CLASS: Record<HealthState, string> = {
  ok: 'bg-status-success-icon',
  degraded: 'bg-status-warning-icon',
  down: 'bg-status-error-icon',
  error: 'bg-status-error-icon',
  unknown: 'bg-status-neutral-icon',
}

const WEB_SEARCH_HEALTH_URL = '/api/agent_orchestrator/web-search/health'

/** Not permitted is not the same fault as not reachable. */
function isDenied(call: { status?: number } | null): boolean {
  return call?.status === 401 || call?.status === 403
}

/**
 * The orchestrator's runtime dependencies, in one KPI-sized tile.
 *
 * It replaces a full-width web-search card that spent a whole row on one of the
 * runtime dependencies, while the harness and capability transport that stop
 * an agent running were not on the page. The per-adapter detail the old
 * card carried is not lost: it moves into the panel, which is where detail
 * belongs on a page you scan.
 *
 * Two independent fetches, so a caller without `ai_assistant.view` still sees
 * web-search health instead of an empty tile. The web-search call asks for
 * `probe=auto`: adapters whose health check is free are verified on entry, and
 * the ones that bill are only ever reused from a cached operator-initiated probe.
 */
export function SystemHealthTile() {
  const t = useT()
  const { payload } = useBackendChrome()
  const canProbe = hasFeature(payload?.grantedFeatures, 'agent_orchestrator.agents.manage')

  const [webSearch, setWebSearch] = React.useState<WebSearchHealthPayload | null>(null)
  const [runtime, setRuntime] = React.useState<AiRuntimeHealthPayload | null>(null)
  const [webSearchFailed, setWebSearchFailed] = React.useState(false)
  const [runtimeFailed, setRuntimeFailed] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [probingAdapterId, setProbingAdapterId] = React.useState<string | null>(null)

  const load = React.useCallback(async (url: string) => {
    setIsLoading(true)
    // Both probes opt out of the throwing 403 path: a denial has to reach
    // `isDenied` as a status, or the panel reports "not permitted" as "broken".
    const [webSearchCall, runtimeCall] = await Promise.all([
      apiCall<unknown>(url, OPTIONAL_REQUEST_INIT).catch(() => null),
      apiCall<unknown>('/api/agent_orchestrator/runtime/health', OPTIONAL_REQUEST_INIT).catch(() => null),
    ])
    const webSearchOk = Boolean(webSearchCall?.ok) && isWebSearchHealthPayload(webSearchCall?.result)
    const runtimeOk = Boolean(runtimeCall?.ok) && isAiRuntimeHealthPayload(runtimeCall?.result)
    setWebSearch(webSearchOk ? (webSearchCall!.result as WebSearchHealthPayload) : null)
    setRuntime(runtimeOk ? (runtimeCall!.result as AiRuntimeHealthPayload) : null)
    // A rejected call is not the same claim as "we did not check" — the panel
    // has to be able to say the health path itself is broken. Being denied is a
    // third thing again: a caller without `ai_assistant.view` still gets the
    // web-search half, and must see the runtime dots grey rather than red.
    setWebSearchFailed(!webSearchOk && !isDenied(webSearchCall))
    setRuntimeFailed(!runtimeOk && !isDenied(runtimeCall))
    setIsLoading(false)
  }, [])

  React.useEffect(() => {
    void load(`${WEB_SEARCH_HEALTH_URL}?probe=auto`)
  }, [load])

  const recheck = React.useCallback(() => {
    void load(`${WEB_SEARCH_HEALTH_URL}?probe=1&force=1`)
  }, [load])

  const testAdapter = React.useCallback(
    (adapterId: string) => {
      setProbingAdapterId(adapterId)
      void load(
        `${WEB_SEARCH_HEALTH_URL}?probe=1&force=1&adapter=${encodeURIComponent(adapterId)}`,
      ).finally(() => setProbingAdapterId(null))
    },
    [load],
  )

  const indicators: HealthIndicator[] = React.useMemo(
    () => [
      deriveWebSearchIndicator(webSearch, webSearchFailed),
      ...deriveRuntimeIndicators(runtime, runtimeFailed),
    ],
    [webSearch, webSearchFailed, runtime, runtimeFailed],
  )
  const rollup = rollupHealth(indicators)

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t('agent_orchestrator.overview.health.title', 'System health')}
        </p>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-brand-violet">
          <Activity className="size-4" />
        </span>
      </div>

      <div className="mt-2 flex min-h-9 items-center gap-2">
        <HealthStateBadge state={rollup} />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              {t('agent_orchestrator.overview.health.details', 'Details')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96">
            <SystemHealthPanel
              indicators={indicators}
              webSearch={webSearch}
              fetchFailed={webSearchFailed && runtimeFailed}
              isLoading={isLoading}
              canProbe={canProbe}
              probingAdapterId={probingAdapterId}
              onRecheck={recheck}
              onTestAdapter={testAdapter}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* The four dots ARE the tile's value — the reader should not have to open
          the panel to learn which dependency is the unhealthy one. */}
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {indicators.map((indicator) => (
          <li key={indicator.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[indicator.state]}`}
            />
            <span className="truncate">
              {indicator.id === 'harness'
                ? runtimeDisplayLabel(t, 'business-harness', indicator.runtimeMode)
                : t(INDICATOR_LABEL_KEY[indicator.id])}
            </span>
            <span className="sr-only">{t(STATE_LABEL_KEY[indicator.state])}</span>
          </li>
        ))}
      </ul>

      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}

export default SystemHealthTile
