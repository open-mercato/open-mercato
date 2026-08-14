"use client"

/**
 * Screen 14 — the sheet the client sees.
 *
 * It is deliberately a dumb renderer: every number arrives already computed by
 * `POST .../reports/preview` or `GET .../reports/[id]/sheet`, which own D-7. The
 * component adds nothing up, because a client-facing total computed in two
 * places is a client-facing total that will eventually disagree with itself.
 *
 * The four mockup notes it implements:
 *
 *  1. **Non-billable time gets its own group at zero** rather than being
 *     omitted. The client sees the full effort and the total stays unambiguous
 *     (US-G2). A dash, never `0,00`, in the rate and amount cells — a zero there
 *     would read as free work rather than as work outside the invoice.
 *  2. **A line carrying a rate override is marked** and prints the rate actually
 *     applied, not the project default (US-F2). Two lines with the same hours
 *     and different amounts look like a bug otherwise.
 *  3. **Child tasks roll up into their parent line and expand underneath**
 *     (D-2), so the sheet reads at the level the client contracted for while the
 *     detail stays one click away.
 *  4. **The grand total spells out the rounding rule** it was produced under, so
 *     an amount with an odd grosz ending is explained on the page rather than in
 *     an email.
 */

import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatReportMinutes } from '../timesheets-reports/reportTotals'
import type { PreviewGroup, PreviewLine } from '../timesheets-reports/reportConfigData'

export type ReportSheetProps = {
  reference: string
  customerName: string
  periodLabel: string
  issuedByLabel: string | null
  issuedAtLabel: string | null
  currencyCode: string | null
  showRates: boolean
  groups: readonly PreviewGroup[]
  totals: {
    billableMinutes: number
    nonbillableMinutes: number
    totalAmount: number | null
  }
  roundingLabel: string
}

const EM_DASH = '—'

function useMoney(currencyCode: string | null) {
  return React.useCallback(
    (amount: number | null | undefined) => {
      if (amount === null || amount === undefined) return EM_DASH
      return formatCurrency(amount, currencyCode ?? undefined) ?? EM_DASH
    },
    [currencyCode],
  )
}

export function ReportSheet({
  reference,
  customerName,
  periodLabel,
  issuedByLabel,
  issuedAtLabel,
  currencyCode,
  showRates,
  groups,
  totals,
  roundingLabel,
}: ReportSheetProps) {
  const t = useT()
  const money = useMoney(currencyCode)

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('staff.time_tracking.reports.sheet.overline', 'Time and cost statement')}
          </span>
          <h2 className="text-lg font-semibold">{customerName}</h2>
          <span className="text-sm text-muted-foreground">{periodLabel}</span>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {issuedByLabel ? (
            <>
              <span className="text-xs text-muted-foreground">
                {t('staff.time_tracking.reports.sheet.issuedBy', 'Issued by')}
              </span>
              <span className="text-sm font-medium">{issuedByLabel}</span>
            </>
          ) : null}
          {issuedAtLabel ? <span className="text-xs text-muted-foreground">{issuedAtLabel}</span> : null}
          <span className="font-mono text-xs text-muted-foreground">{reference}</span>
        </div>
      </header>

      {groups.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          {t('staff.time_tracking.reports.sheet.empty', 'No time was logged in this period for the selected projects.')}
        </p>
      ) : (
        groups.map((group) => (
          <ReportSheetGroup
            key={group.key}
            group={group}
            showRates={showRates}
            money={money}
          />
        ))
      )}

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border p-6">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">
            {t('staff.time_tracking.reports.sheet.total', 'Total to invoice')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t(
              'staff.time_tracking.reports.sheet.totalHint',
              '{billable} billable · {nonbillable} non-billable · {rounding}',
            )
              .replace('{billable}', formatReportMinutes(totals.billableMinutes))
              .replace('{nonbillable}', formatReportMinutes(totals.nonbillableMinutes))
              .replace('{rounding}', roundingLabel)}
          </span>
        </div>
        <span className="font-mono text-xl font-semibold tabular-nums">{money(totals.totalAmount)}</span>
      </footer>
    </section>
  )
}

type GroupProps = {
  group: PreviewGroup
  showRates: boolean
  money: (amount: number | null | undefined) => string
}

function ReportSheetGroup({ group, showRates, money }: GroupProps) {
  const t = useT()
  const isNonBillable = group.kind === 'nonbillable'

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 px-6 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{group.label}</span>
          <span className="text-xs text-muted-foreground">
            {isNonBillable
              ? t('staff.time_tracking.reports.sheet.nonbillableHint', 'Shown for information, outside the invoice')
              : showRates && group.rate !== null
                ? `${money(group.rate)}/h`
                : ''}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm tabular-nums">{formatReportMinutes(group.minutes)}</span>
          <span
            className={`font-mono text-sm tabular-nums ${isNonBillable ? 'text-muted-foreground' : 'font-semibold'}`}
          >
            {isNonBillable ? money(0) : money(group.amount)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-6 py-2 text-left font-medium">
                {t('staff.time_tracking.reports.sheet.lineLabel', 'Line')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t('staff.time_tracking.reports.sheet.time', 'Time')}
              </th>
              {showRates ? (
                <th className="px-3 py-2 text-right font-medium">
                  {t('staff.time_tracking.reports.sheet.rate', 'Rate')}
                </th>
              ) : null}
              <th className="px-6 py-2 text-right font-medium">
                {t('staff.time_tracking.reports.sheet.amount', 'Amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line) => (
              <ReportSheetLine
                key={line.key}
                line={line}
                depth={0}
                isNonBillable={isNonBillable}
                showRates={showRates}
                money={money}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type LineProps = {
  line: PreviewLine
  depth: number
  isNonBillable: boolean
  showRates: boolean
  money: (amount: number | null | undefined) => string
}

function ReportSheetLine({ line, depth, isNonBillable, showRates, money }: LineProps) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const hasChildren = line.children.length > 0
  const columns = showRates ? 4 : 3

  return (
    <>
      <tr className="border-b border-border/60 last:border-b-0">
        <td className="px-6 py-2" style={{ paddingLeft: `${1.5 + depth * 1.25}rem` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? t('staff.time_tracking.reports.sheet.collapse', 'Hide subtasks')
                    : t('staff.time_tracking.reports.sheet.expand', 'Show subtasks')
                }
              >
                {expanded ? (
                  <ChevronDown className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4" aria-hidden="true" />
                )}
              </button>
            ) : null}
            <span>{line.label}</span>
            {line.hasOverride ? (
              <Badge variant="secondary">
                {t('staff.time_tracking.reports.sheet.overrideBadge', 'agreed rate')}
              </Badge>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatReportMinutes(line.minutes)}</td>
        {showRates ? (
          <td className="px-3 py-2 text-right font-mono tabular-nums">
            {isNonBillable ? EM_DASH : money(line.rate)}
          </td>
        ) : null}
        <td className="px-6 py-2 text-right font-mono tabular-nums">
          {isNonBillable ? EM_DASH : money(line.amount)}
        </td>
      </tr>
      {expanded
        ? line.children.map((child) => (
            <ReportSheetLine
              key={child.key}
              line={child}
              depth={depth + 1}
              isNonBillable={isNonBillable}
              showRates={showRates}
              money={money}
            />
          ))
        : null}
      {expanded && line.children.length === 0 ? (
        <tr>
          <td colSpan={columns} className="px-6 py-2 text-xs text-muted-foreground">
            {t('staff.time_tracking.reports.sheet.noSubtasks', 'No subtasks')}
          </td>
        </tr>
      ) : null}
    </>
  )
}

export default ReportSheet
