"use client"

import * as React from 'react'
import { RotateCw } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { HealthIndicator, HealthIndicatorId, WebSearchHealthPayload } from '../../lib/systemHealth'
import { HealthRow } from './HealthRow'
import { HealthStateBadge } from './HealthStateBadge'
import { formatProbeAge } from './vocabulary'
import { runtimeDisplayLabel } from '../runtimeLabel'

const INDICATOR_LABEL_KEY: Record<HealthIndicatorId, string> = {
  webSearch: 'agent_orchestrator.overview.health.webSearch',
  harness: 'agent_orchestrator.overview.health.harness',
  capability: 'agent_orchestrator.overview.health.capability',
}

const RUNTIME_ORDER: HealthIndicatorId[] = ['harness', 'capability']

export type SystemHealthPanelProps = {
  indicators: readonly HealthIndicator[]
  webSearch: WebSearchHealthPayload | null
  fetchFailed: boolean
  isLoading: boolean
  /** Whether this operator may spend a billable probe. */
  canProbe: boolean
  probingAdapterId: string | null
  onRecheck: () => void
  onTestAdapter: (adapterId: string) => void
}

export function SystemHealthPanel({
  indicators,
  webSearch,
  fetchFailed,
  isLoading,
  canProbe,
  probingAdapterId,
  onRecheck,
  onTestAdapter,
}: SystemHealthPanelProps) {
  const t = useT()
  // One clock reading per render keeps every row's age consistent with the others.
  const nowMs = Date.now()

  const byId = React.useMemo(() => {
    const map = new Map<HealthIndicatorId, HealthIndicator>()
    for (const indicator of indicators) map.set(indicator.id, indicator)
    return map
  }, [indicators])

  const webSearchIndicator = byId.get('webSearch')
  const enabledAdapters = webSearch?.adapters.filter((adapter) => adapter.enabled) ?? []
  const disabledAdapters = webSearch?.adapters.filter((adapter) => !adapter.enabled) ?? []
  const disabledIds = disabledAdapters.map((adapter) => adapter.id).join(', ')

  // The panel owns its own inset: `PopoverContent` defaults to `p-0`, and this
  // component is meant to drop into any host without the caller remembering to
  // pad it.
  return (
    <div className="space-y-3 p-4" data-testid="system-health-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {t('agent_orchestrator.overview.health.title', 'System health')}
        </p>
        {canProbe ? (
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('agent_orchestrator.health.recheck', 'Recheck')}
            disabled={isLoading}
            onClick={onRecheck}
          >
            <RotateCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          </IconButton>
        ) : null}
      </div>

      {fetchFailed ? (
        <Alert status="error" size="sm">
          <AlertDescription>
            {t('agent_orchestrator.health.fetchError', 'Could not read system health.')}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-96 space-y-3 overflow-y-auto">
        <section className="space-y-1.5">
          <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
            {t('agent_orchestrator.health.sectionRuntime', 'Runtime')}
          </p>
          <ul className="space-y-1.5">
            {RUNTIME_ORDER.map((id) => {
              const indicator = byId.get(id)
              if (!indicator) return null
              return (
                <HealthRow
                  key={id}
                  label={
                    id === 'harness'
                      ? runtimeDisplayLabel(t, 'business-harness', indicator.runtimeMode)
                      : t(INDICATOR_LABEL_KEY[id])
                  }
                  detail={indicator.detail}
                  trailing={<HealthStateBadge state={indicator.state} />}
                />
              )
            })}
          </ul>
        </section>

        {webSearchIndicator ? (
          <section className="space-y-1.5 border-t border-border pt-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                {t('agent_orchestrator.health.sectionWebSearch', 'Web search')}
              </p>
              <HealthStateBadge state={webSearchIndicator.state} />
            </div>

            {enabledAdapters.length > 0 ? (
              <ul className="space-y-1.5">
                {enabledAdapters.map((adapter) => {
                  const age = formatProbeAge(adapter.checkedAt, nowMs)
                  const verified = adapter.ready && adapter.probed === true
                  const detail = verified
                    ? [adapter.latencyMs !== null ? `${adapter.latencyMs}ms` : null, age]
                        .filter(Boolean)
                        .join(' · ') || null
                    : adapter.detail
                  return (
                    <HealthRow
                      key={adapter.id}
                      monoLabel
                      label={adapter.id}
                      detail={detail}
                      trailing={
                        <>
                          {verified ? (
                            <StatusBadge variant={adapter.ok ? 'success' : 'warning'} dot className="whitespace-nowrap">
                              {adapter.ok
                                ? t('agent_orchestrator.overview.webSearch.adapter.ok', 'OK')
                                : t('agent_orchestrator.overview.webSearch.adapter.problem', 'Problem')}
                            </StatusBadge>
                          ) : (
                            <StatusBadge variant={adapter.ready ? 'neutral' : 'warning'} dot className="whitespace-nowrap">
                              {adapter.ready
                                ? t('agent_orchestrator.health.notVerified', 'Not verified')
                                : t('agent_orchestrator.overview.webSearch.adapter.problem', 'Problem')}
                            </StatusBadge>
                          )}
                          {canProbe && adapter.ready ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={probingAdapterId !== null}
                              title={t(
                                'agent_orchestrator.health.testHint',
                                'Calls this adapter for real. A metered source bills for it.',
                              )}
                              onClick={() => onTestAdapter(adapter.id)}
                            >
                              {t('agent_orchestrator.health.test', 'Test')}
                            </Button>
                          ) : null}
                        </>
                      }
                    />
                  )
                })}
              </ul>
            ) : null}

            {disabledIds ? (
              <p className="truncate text-xs text-muted-foreground" title={disabledIds}>
                {t('agent_orchestrator.overview.webSearch.disabledAdapters', 'Installed but off: {ids}', {
                  ids: disabledIds,
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
          </section>
        ) : null}
      </div>

      <p className="border-t border-border pt-2 text-xs text-muted-foreground">
        {formatProbeAge(webSearch?.checkedAt ?? null, nowMs)
          ? t('agent_orchestrator.health.checkedAgo', 'Checked {age} ago', {
              age: formatProbeAge(webSearch?.checkedAt ?? null, nowMs) as string,
            })
          : t('agent_orchestrator.health.neverChecked', 'Never checked')}
      </p>
    </div>
  )
}
