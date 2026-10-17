"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { simulationSummaryLabel, translateSimulationKey } from '../../lib/client/simulation/format'
import type { SimulationResultSummary as SimulationResultSummaryValue } from '../../lib/client/simulation/types'
import { formatCount } from '../../lib/client/xray/format'

/** Items of a summary list shown in the compact form (the dialog); the result page shows all. */
export const SIMULATION_SUMMARY_COMPACT_ITEMS = 12

type SimulationResultSummaryProps = {
  kind: string
  summary: SimulationResultSummaryValue | null | undefined
  compact?: boolean
}

/**
 * The kind-level facts of a result: warnings first (an error alert: text + icon, never color
 * alone), then the counts (e.g. pages and API routes gained or lost) and the catalog lists (e.g.
 * features gained or lost). Labels are the owning module's (`<module>.simulation.summary.<key>`).
 */
export function SimulationResultSummary({ kind, summary, compact = false }: SimulationResultSummaryProps) {
  const t = useT()
  const locale = useLocale()
  if (!summary) return null
  const counts = Object.entries(summary.counts ?? {})
  const lists = Object.entries(summary.lists ?? {})
  const warnings = summary.warnings ?? []
  if (warnings.length === 0 && counts.length === 0 && lists.length === 0) return null
  return (
    <section className="space-y-3" data-testid="simulation-summary">
      {warnings.length > 0 ? (
        <Alert status="error" size="default" data-testid="simulation-summary-warnings">
          <AlertTitle>{t('insights.simulation.ui.summary.warningsTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((warning) => (
                <li key={warning} data-warning={warning}>{translateSimulationKey(warning, t)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {counts.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2" aria-label={t('insights.simulation.ui.summary.countsTitle')}>
          {counts.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 border-b py-1" data-summary-count={key}>
              <dt className="text-muted-foreground">{simulationSummaryLabel(kind, key, t)}</dt>
              <dd className="font-medium tabular-nums">{formatCount(value, locale)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {lists.map(([key, items]) => {
        const shown = compact ? items.slice(0, SIMULATION_SUMMARY_COMPACT_ITEMS) : items
        const hidden = items.length - shown.length
        return (
          <div key={key} className="space-y-1" data-summary-list={key}>
            <h3 className="text-sm font-medium">
              {t('insights.simulation.ui.summary.listTitle', { label: simulationSummaryLabel(kind, key, t), count: formatCount(items.length, locale) })}
            </h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('insights.simulation.ui.common.none')}</p>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {shown.map((item) => (
                  <li key={item}>
                    <Tag variant="neutral" shape="square" className="font-mono">{item}</Tag>
                  </li>
                ))}
              </ul>
            )}
            {hidden > 0 ? (
              <p className="text-xs text-muted-foreground">{t('insights.simulation.ui.summary.more', { count: formatCount(hidden, locale) })}</p>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
