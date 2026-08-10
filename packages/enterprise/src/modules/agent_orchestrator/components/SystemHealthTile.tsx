"use client"

import * as React from 'react'
import { Activity, RotateCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverTrigger, PopoverContent } from '@open-mercato/ui/primitives/popover'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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

const stateVariant: StatusMap<HealthState> = {
  ok: 'success',
  degraded: 'warning',
  down: 'error',
  unknown: 'neutral',
}

const INDICATOR_LABEL_KEY: Record<HealthIndicatorId, string> = {
  webSearch: 'agent_orchestrator.overview.health.webSearch',
  mcp: 'agent_orchestrator.overview.health.mcp',
  opencode: 'agent_orchestrator.overview.health.opencode',
  opencodeMcp: 'agent_orchestrator.overview.health.opencodeMcp',
}

const STATE_LABEL_KEY: Record<HealthState, string> = {
  ok: 'agent_orchestrator.overview.health.state.ok',
  degraded: 'agent_orchestrator.overview.health.state.degraded',
  down: 'agent_orchestrator.overview.health.state.down',
  unknown: 'agent_orchestrator.overview.health.state.unknown',
}

/**
 * The orchestrator's runtime dependencies, in one KPI-sized tile.
 *
 * It replaces a full-width web-search card that spent a whole row on one of the
 * four things that can be down, while the two that stop an agent running at all
 * — MCP and OpenCode — were not on the page. The per-adapter detail the old
 * card carried is not lost: it moves into the popover, which is where detail
 * belongs on a page you scan.
 *
 * Read-only. Two independent fetches, so a caller without `ai_assistant.view`
 * still sees web-search health instead of an empty tile.
 */
export function SystemHealthTile() {
  const t = useT()
  const [webSearch, setWebSearch] = React.useState<WebSearchHealthPayload | null>(null)
  const [runtime, setRuntime] = React.useState<AiRuntimeHealthPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    const [webSearchCall, runtimeCall] = await Promise.all([
      apiCall<unknown>('/api/agent_orchestrator/web-search/health').catch(() => null),
      apiCall<unknown>('/api/ai_assistant/health').catch(() => null),
    ])
    setWebSearch(
      webSearchCall?.ok && isWebSearchHealthPayload(webSearchCall.result) ? webSearchCall.result : null,
    )
    setRuntime(
      runtimeCall?.ok && isAiRuntimeHealthPayload(runtimeCall.result) ? runtimeCall.result : null,
    )
    setIsLoading(false)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const indicators: HealthIndicator[] = React.useMemo(
    () => [deriveWebSearchIndicator(webSearch), ...deriveRuntimeIndicators(runtime)],
    [webSearch, runtime],
  )
  const rollup = rollupHealth(indicators)

  const enabledAdapters = webSearch?.adapters.filter((adapter) => adapter.enabled) ?? []
  const disabledAdapters = webSearch?.adapters.filter((adapter) => !adapter.enabled) ?? []

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
        <StatusBadge variant={stateVariant[rollup]} dot>
          {t(STATE_LABEL_KEY[rollup])}
        </StatusBadge>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {t('agent_orchestrator.overview.health.details', 'Details')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {t('agent_orchestrator.overview.health.title', 'System health')}
              </p>
              <Button
                variant="outline"
                size="sm"
                aria-label={t('agent_orchestrator.overview.health.recheck', 'Recheck')}
                disabled={isLoading}
                onClick={() => {
                  void load()
                }}
              >
                <RotateCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
              </Button>
            </div>

            <ul className="space-y-1.5">
              {indicators.map((indicator) => (
                <li key={indicator.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="text-foreground">{t(INDICATOR_LABEL_KEY[indicator.id])}</span>
                  <span className="flex items-center gap-1.5 text-right">
                    {indicator.detail ? (
                      <span className="font-mono text-muted-foreground">{indicator.detail}</span>
                    ) : null}
                    <StatusBadge variant={stateVariant[indicator.state]} dot>
                      {t(STATE_LABEL_KEY[indicator.state])}
                    </StatusBadge>
                  </span>
                </li>
              ))}
            </ul>

            {enabledAdapters.length > 0 ? (
              <ul className="space-y-1 border-t border-border pt-2">
                {enabledAdapters.map((adapter) => (
                  <li key={adapter.id} className="flex items-center gap-2 text-xs">
                    <StatusBadge variant={adapter.ok ? 'success' : adapter.ready ? 'warning' : 'neutral'} dot>
                      {adapter.ok
                        ? t('agent_orchestrator.overview.webSearch.adapter.ok', 'OK')
                        : t('agent_orchestrator.overview.webSearch.adapter.problem', 'Problem')}
                    </StatusBadge>
                    <span className="font-mono text-foreground">{adapter.id}</span>
                    {adapter.latencyMs !== null ? (
                      <span className="text-muted-foreground">{`${adapter.latencyMs}ms`}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {disabledAdapters.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('agent_orchestrator.overview.webSearch.disabledAdapters', 'Installed but disabled: {ids}', {
                  ids: disabledAdapters.map((adapter) => adapter.id).join(', '),
                })}
              </p>
            ) : null}

            {webSearch?.problems.length ? (
              <ul className="space-y-1">
                {webSearch.problems.map((problem) => (
                  <li key={problem.packageName} className="text-xs text-status-warning-text">
                    {`${problem.packageName}: ${problem.reason}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      {/* The four dots ARE the tile's value — the reader should not have to open
          the popover to learn which dependency is the unhealthy one. */}
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {indicators.map((indicator) => (
          <li key={indicator.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                indicator.state === 'ok'
                  ? 'bg-status-success-text'
                  : indicator.state === 'degraded'
                    ? 'bg-status-warning-text'
                    : indicator.state === 'down'
                      ? 'bg-status-error-text'
                      : 'bg-muted-foreground'
              }`}
            />
            <span className="truncate">{t(INDICATOR_LABEL_KEY[indicator.id])}</span>
            <span className="sr-only">{t(STATE_LABEL_KEY[indicator.state])}</span>
          </li>
        ))}
      </ul>

      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-brand-lime via-brand-lime to-brand-violet" />
    </div>
  )
}

export default SystemHealthTile
