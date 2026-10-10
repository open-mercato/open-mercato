"use client"

import * as React from 'react'
import Link from 'next/link'
import { EyeOff, Flag, TriangleAlert } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { isSafeInternalHref } from '../../lib/client/explainApi'
import {
  formatSimulationMeasure,
  simulationCellLabel,
  simulationFlagLabel,
  simulationGroupHeading,
  simulationGroupSuppressedLabel,
  simulationGroupTotalLabel,
  simulationMeasureLabel,
  translateSimulationKey,
} from '../../lib/client/simulation/format'
import type { SimulationResultCell, SimulationResultGroup, SimulationSample } from '../../lib/client/simulation/types'
import { formatCount, shortId } from '../../lib/client/xray/format'

/** A cell count, or why it is hidden: fewer than k records, or hidden so a small cell cannot be derived. */
export function SimulationCellCount({ cell, k }: { cell: SimulationResultCell; k: number }) {
  const t = useT()
  const locale = useLocale()
  if (cell.suppressed === 'below_k') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" data-testid="simulation-cell-below-k">
        <EyeOff className="size-3" aria-hidden="true" />
        {t('insights.simulation.ui.result.fewerThanK', { k: formatCount(k, locale) })}
      </span>
    )
  }
  if (cell.suppressed === 'complementary') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" data-testid="simulation-cell-complementary">
        <EyeOff className="size-3" aria-hidden="true" />
        {t('insights.simulation.ui.result.hidden')}
      </span>
    )
  }
  if (cell.count === null) return <span className="text-muted-foreground">{t('insights.simulation.ui.common.none')}</span>
  return <span className="font-medium tabular-nums">{formatCount(cell.count, locale)}</span>
}

function GroupTotal({ kind, group, k }: { kind: string; group: SimulationResultGroup; k: number }) {
  const t = useT()
  const locale = useLocale()
  if (group.suppressed || group.total === null) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground" data-testid="simulation-group-suppressed">
        <EyeOff className="size-4" aria-hidden="true" />
        {simulationGroupSuppressedLabel(kind, formatCount(k, locale), t)}
      </span>
    )
  }
  return (
    <span className="text-sm text-muted-foreground" data-testid="simulation-group-total">
      {simulationGroupTotalLabel(kind, formatCount(group.total, locale), t)}
    </span>
  )
}

export function SimulationWarnings({ warnings }: { warnings: readonly string[] }) {
  const t = useT()
  if (warnings.length === 0) return null
  return (
    <ul className="space-y-1" aria-label={t('insights.simulation.ui.result.warnings')} data-testid="simulation-warnings">
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning-icon" aria-hidden="true" />
          <span>{translateSimulationKey(warning, t)}</span>
        </li>
      ))}
    </ul>
  )
}

function SimulationFlags({ kind, flags }: { kind: string; flags: readonly string[] }) {
  const t = useT()
  if (flags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t('insights.simulation.ui.result.flags')} data-testid="simulation-flags">
      {flags.map((flag) => (
        <StatusBadge key={flag} variant="warning">
          <span className="inline-flex items-center gap-1">
            <Flag className="size-3" aria-hidden="true" />
            {simulationFlagLabel(kind, flag, t)}
          </span>
        </StatusBadge>
      ))}
    </div>
  )
}

function SampleLinks({ samples }: { samples: readonly SimulationSample[] }) {
  const t = useT()
  if (samples.length === 0) return <span className="text-muted-foreground">{t('insights.simulation.ui.common.none')}</span>
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {samples.map((sample) => (
        <li key={sample.id} className="font-mono text-xs">
          {isSafeInternalHref(sample.href) ? (
            <LinkButton asChild variant="primary" size="sm" underline="always">
              <Link href={sample.href} title={sample.id} data-testid="simulation-sample-link">{shortId(sample.id)}</Link>
            </LinkButton>
          ) : (
            <span title={sample.id} data-testid="simulation-sample-id">{shortId(sample.id)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The decimal aggregates of a group (e.g. revenue per currency of a price backtest), each in its own
 * currency. They are present only while the cell they describe is visible; a group whose measures
 * were hidden by k-suppression says so. Kinds without measures render nothing.
 */
export function SimulationGroupMeasures({ kind, group }: { kind: string; group: SimulationResultGroup }) {
  const t = useT()
  const locale = useLocale()
  const measures = group.measures
  if (!measures) return null
  if (group.suppressed || measures.length === 0) {
    return (
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="simulation-measures-hidden">
        <EyeOff className="size-3" aria-hidden="true" />
        {t('insights.simulation.ui.result.measuresHidden')}
      </p>
    )
  }
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" aria-label={t('insights.simulation.ui.result.measures')} data-testid="simulation-measures">
      {measures.map((measure) => (
        <div key={`${measure.cell}:${measure.key}`} className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:justify-start" data-measure={measure.key}>
          <dt className="text-muted-foreground">{simulationMeasureLabel(kind, measure.key, t)}</dt>
          <dd className="font-medium tabular-nums">{formatSimulationMeasure(measure, locale)}</dd>
        </div>
      ))}
    </dl>
  )
}

type SimulationGroupProps = {
  kind: string
  group: SimulationResultGroup
  k: number
  /** The run's own proposal: kind-specific headings read labels from it (e.g. trigger names). */
  proposal?: unknown
  /** Display names of groups resolved live with the run's records (e.g. organization names). */
  groupLabels?: Record<string, string> | null
}

/** The compact form of a group (the "Simulate impact" dialog): total, one count per outcome, warnings. */
export function SimulationGroupHeadline({ kind, group, k, proposal, groupLabels }: SimulationGroupProps) {
  const t = useT()
  const heading = simulationGroupHeading(kind, group, proposal, t, groupLabels)
  return (
    <section className="space-y-2 rounded-md border p-3" data-testid="simulation-group-headline" data-group={group.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{heading.title}</h3>
          {heading.subtitle && heading.subtitle !== group.key ? <p className="text-xs text-muted-foreground">{heading.subtitle}</p> : null}
        </div>
        <GroupTotal kind={kind} group={group} k={k} />
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {group.cells.map((cell) => (
          <div key={cell.key} className="flex items-baseline justify-between gap-2" data-cell={cell.key}>
            <dt className="text-muted-foreground">{simulationCellLabel(kind, cell.key, t)}</dt>
            <dd><SimulationCellCount cell={cell} k={k} /></dd>
          </div>
        ))}
      </dl>
      <SimulationGroupMeasures kind={kind} group={group} />
      <SimulationWarnings warnings={group.warnings} />
    </section>
  )
}

/** One result group of the result page: total, outcomes with their counts and live-resolved samples, warnings and flags. */
export function SimulationGroupSection({ kind, group, k, proposal, groupLabels }: SimulationGroupProps) {
  const t = useT()
  const heading = simulationGroupHeading(kind, group, proposal, t, groupLabels)
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="simulation-group" data-group={group.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{heading.title}</h3>
          {heading.subtitle ? <p className={heading.subtitle === group.key ? 'font-mono text-xs text-muted-foreground' : 'text-xs text-muted-foreground'}>{heading.subtitle}</p> : null}
        </div>
        <GroupTotal kind={kind} group={group} k={k} />
      </div>
      <SimulationWarnings warnings={group.warnings} />
      <SimulationFlags kind={kind} flags={group.flags} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('insights.simulation.ui.result.columns.outcome')}</TableHead>
            <TableHead>{t('insights.simulation.ui.result.columns.count')}</TableHead>
            <TableHead>{t('insights.simulation.ui.result.columns.samples')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.cells.map((cell) => (
            <TableRow key={cell.key} data-cell={cell.key}>
              <TableCell>{simulationCellLabel(kind, cell.key, t)}</TableCell>
              <TableCell><SimulationCellCount cell={cell} k={k} /></TableCell>
              <TableCell><SampleLinks samples={cell.samples} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <SimulationGroupMeasures kind={kind} group={group} />
    </section>
  )
}
