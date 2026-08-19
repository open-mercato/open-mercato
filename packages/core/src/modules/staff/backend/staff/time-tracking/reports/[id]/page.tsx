"use client"

/**
 * Screens 14 and 15 — the report preview, its exports, and the lock/unlock pair.
 *
 * One page, two states, because they are the same document:
 *
 *  - **Draft (screen 14).** The sheet is computed live, the header carries the
 *    three export buttons and one primary action, "Close & lock". Exporting is
 *    deliberately NOT the thing that locks (note 5) — a PDF download that froze
 *    a team's timesheet would be a trap.
 *  - **Closed (screen 15).** The sheet is what was frozen, an alert states that
 *    the entries are read-only and that logging NEW time on the same tasks still
 *    works (note 2), the frozen entries are listed, the history timeline shows
 *    who closed, unlocked or exported and why, and the unlock button is
 *    `destructive-outline` rather than full destructive (note 3): risky, but
 *    reversible, since the report can simply be closed again.
 *
 * Unlocking demands a reason (note 1). The dialog shows the export history first
 * so "this was already sent to the client on the 20th" is on screen before
 * anybody restates a billed hour.
 */

import * as React from 'react'
import { Download, Lock, LockOpen } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ReportSheet } from '../../../../../lib/time-tracking-ui/ReportSheet'
import {
  parseReportSheet,
  type ReportHistoryEvent,
  type ReportSheetPayload,
} from '../../../../../lib/timesheets-reports/reportSheetData'
import { formatReportMinutes } from '../../../../../lib/timesheets-reports/reportTotals'

const logger = createLogger('staff').child({ component: 'time-tracking/reports/detail' })

const REPORTS_HREF = '/backend/staff/time-tracking/reports'
const REPORTS_API = '/api/staff/timesheets/reports'
const LOCK_FEATURE = 'staff.timesheets.lock'
const UNLOCK_FEATURE = 'staff.timesheets.reports.unlock'
const RATES_FEATURE = 'staff.timesheets.rates.view'
const MUTATION_CONTEXT_ID = 'staff.time_tracking.reportDetail'
const RESOURCE_KIND = 'staff.timesheets.time_report'
const EXPORT_FORMATS = ['pdf', 'csv', 'xlsx'] as const

type ExportFormat = (typeof EXPORT_FORMATS)[number]

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'string' && error.trim().length > 0) return error
  }
  return fallback
}

/**
 * `params` arrives as a prop, not from `useParams()`.
 *
 * Backend pages render under the `/backend/[[...slug]]` catch-all, so
 * `useParams()` answers `{ slug: [...] }` — there is no `id` key in it, and
 * reading one yields `undefined`. The effect then short-circuits on the empty id
 * and the page sits on its loading state forever, having issued no request at
 * all. The catch-all passes the resolved segment as a prop; that is the contract
 * every other detail page in the module already uses.
 */
export default function TimeTrackingReportDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const reportId = typeof params?.id === 'string' ? params.id : ''
  const { payload: chrome } = useBackendChrome()
  const canClose = hasFeature(chrome?.grantedFeatures, LOCK_FEATURE)
  const canUnlock = hasFeature(chrome?.grantedFeatures, UNLOCK_FEATURE)
  const canSeeMoney = hasFeature(chrome?.grantedFeatures, RATES_FEATURE)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [sheet, setSheet] = React.useState<ReportSheetPayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [unlockOpen, setUnlockOpen] = React.useState(false)
  const [unlockReason, setUnlockReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(
    () => ({
      loadError: t('staff.time_tracking.reports.errors.loadFailed', 'Could not load this report.'),
      closeError: t('staff.time_tracking.reports.errors.closeFailed', 'Could not close this report.'),
      unlockError: t('staff.time_tracking.reports.errors.unlockFailed', 'Could not unlock this report.'),
      exportError: t('staff.time_tracking.reports.errors.exportFailed', 'Could not export this report.'),
    }),
    [t],
  )

  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: labels.closeError,
  })

  const mutationContext = React.useCallback(
    (): MutationContext => ({
      formId: MUTATION_CONTEXT_ID,
      resourceKind: RESOURCE_KIND,
      resourceId: reportId,
      retryLastMutation,
    }),
    [reportId, retryLastMutation],
  )

  React.useEffect(() => {
    if (!reportId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void readApiResultOrThrow<Record<string, unknown>>(
      `${REPORTS_API}/${reportId}/sheet`,
      undefined,
      { allowNullResult: true, errorMessage: labels.loadError },
    )
      .then((result) => {
        if (cancelled) return
        const parsed = parseReportSheet(result)
        if (!parsed) {
          setError(labels.loadError)
          setSheet(null)
          return
        }
        setSheet(parsed)
      })
      .catch((err) => {
        if (cancelled) return
        logger.error('staff.time_tracking.reports sheet load failed', { err })
        setError(err instanceof Error ? err.message : labels.loadError)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [labels.loadError, reloadToken, reportId])

  const money = React.useCallback(
    (amount: number | null | undefined) => {
      if (amount === null || amount === undefined) return '—'
      return formatCurrency(amount, sheet?.report.currencyCode ?? undefined) ?? '—'
    },
    [sheet?.report.currencyCode],
  )

  const roundingLabel = React.useMemo(() => {
    const unit = sheet?.report.roundingUnitMinutes ?? 0
    if (!unit) return t('staff.time_tracking.reports.rounding.off', 'no rounding')
    const direction =
      sheet?.report.roundingDirection === 'nearest'
        ? t('staff.time_tracking.reports.rounding.nearest', 'to the nearest')
        : t('staff.time_tracking.reports.rounding.up', 'always up')
    return t('staff.time_tracking.reports.rounding.rule', 'rounding {minutes} min, {direction}')
      .replace('{minutes}', String(unit))
      .replace('{direction}', direction)
  }, [sheet?.report.roundingDirection, sheet?.report.roundingUnitMinutes, t])

  const handleExport = React.useCallback(
    async (format: ExportFormat) => {
      if (!reportId) return
      try {
        const call = await apiCall<Blob>(
          `${REPORTS_API}/${reportId}/export?format=${format}`,
          undefined,
          { parse: (response) => response.blob() },
        )
        if (!call.ok || !call.result) {
          flash(labels.exportError, 'error')
          return
        }
        if (typeof window === 'undefined') return
        const href = URL.createObjectURL(call.result)
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = `${sheet?.report.reference || 'report'}.${format}`
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        URL.revokeObjectURL(href)
        // The export appended an `exported` event; refresh so the history shows
        // it before anybody reads the unlock dialog's "already sent" warning.
        setReloadToken((current) => current + 1)
      } catch (err) {
        logger.error('staff.time_tracking.reports export failed', { err })
        flash(labels.exportError, 'error')
      }
    },
    [labels.exportError, reportId, sheet?.report.reference],
  )

  const handleClose = React.useCallback(async () => {
    if (!reportId || !sheet) return
    const confirmed = await confirm({
      title: t('staff.time_tracking.reports.close.confirmTitle', 'Close and lock this report?'),
      description: t(
        'staff.time_tracking.reports.close.confirmBody',
        'The {count} entries it covers become read-only at their current values. New time can still be logged on the same tasks and will go into the next report.',
      ).replace('{count}', String(sheet.totals.entryCount)),
      confirmText: t('staff.time_tracking.reports.close.action', 'Close & lock'),
    })
    if (!confirmed) return

    setBusy(true)
    try {
      const call = await runMutation({
        operation: () => apiCall<Record<string, unknown>>(`${REPORTS_API}/${reportId}/close`, { method: 'POST' }),
        context: mutationContext(),
        mutationPayload: { id: reportId },
      })
      if (!call.ok) {
        flash(readErrorMessage(call.result, labels.closeError), 'error')
        return
      }
      flash(t('staff.time_tracking.reports.close.done', 'Report closed. Its entries are locked.'), 'success')
      setReloadToken((current) => current + 1)
    } catch (err) {
      logger.error('staff.time_tracking.reports close failed', { err })
      flash(err instanceof Error ? err.message : labels.closeError, 'error')
    } finally {
      setBusy(false)
    }
  }, [confirm, labels.closeError, mutationContext, reportId, runMutation, sheet, t])

  const handleUnlock = React.useCallback(async () => {
    if (!reportId || unlockReason.trim().length === 0) return
    setBusy(true)
    try {
      const call = await runMutation({
        operation: () =>
          apiCall<Record<string, unknown>>(`${REPORTS_API}/${reportId}/unlock`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: unlockReason.trim() }),
          }),
        context: mutationContext(),
        mutationPayload: { id: reportId, reason: unlockReason.trim() },
      })
      if (!call.ok) {
        flash(readErrorMessage(call.result, labels.unlockError), 'error')
        return
      }
      flash(
        t('staff.time_tracking.reports.unlock.done', 'Report unlocked. Its entries can be edited again.'),
        'success',
      )
      setUnlockOpen(false)
      setUnlockReason('')
      setReloadToken((current) => current + 1)
    } catch (err) {
      logger.error('staff.time_tracking.reports unlock failed', { err })
      flash(err instanceof Error ? err.message : labels.unlockError, 'error')
    } finally {
      setBusy(false)
    }
  }, [labels.unlockError, mutationContext, reportId, runMutation, t, unlockReason])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('staff.time_tracking.reports.detail.loading', 'Loading report…')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !sheet) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? labels.loadError} />
        </PageBody>
      </Page>
    )
  }

  const isClosed = sheet.report.status === 'closed'
  const lastExport = sheet.events.find((event) => event.eventType === 'exported') ?? null

  return (
    <Page>
      <PageBody>
        <FormHeader
          mode="detail"
          backHref={REPORTS_HREF}
          title={sheet.report.title}
          subtitle={`${sheet.report.periodFrom ?? ''} – ${sheet.report.periodTo ?? ''}`}
          statusBadge={
            isClosed ? (
              <Badge variant="success">
                <Lock aria-hidden="true" className="size-3" />
                {t('staff.time_tracking.reports.status.closed', 'Closed')}
              </Badge>
            ) : (
              <Badge variant="warning">{t('staff.time_tracking.reports.status.draft', 'Draft')}</Badge>
            )
          }
          actionsContent={
            <div className="flex flex-wrap items-center gap-2">
              {EXPORT_FORMATS.map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  onClick={() => void handleExport(format)}
                  disabled={busy}
                >
                  <Download aria-hidden="true" />
                  {format.toUpperCase()}
                </Button>
              ))}
              {isClosed ? (
                canUnlock ? (
                  <Button
                    variant="destructive-outline"
                    onClick={() => setUnlockOpen(true)}
                    disabled={busy}
                  >
                    <LockOpen aria-hidden="true" />
                    {t('staff.time_tracking.reports.unlock.action', 'Unlock entries')}
                  </Button>
                ) : null
              ) : canClose ? (
                <Button onClick={() => void handleClose()} disabled={busy}>
                  <Lock aria-hidden="true" />
                  {t('staff.time_tracking.reports.close.action', 'Close & lock')}
                </Button>
              ) : null}
            </div>
          }
        />

        {isClosed ? (
          <Alert status="success" icon={<Lock aria-hidden="true" />} className="mb-4">
            <AlertTitle>
              {t('staff.time_tracking.reports.locked.title', 'The entries in this report are read-only')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'staff.time_tracking.reports.locked.body',
                'Their time, rate and billable flag cannot change without unlocking. New time can still be logged on the same tasks — it goes into the next report.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {sheet.alreadyReportedCount > 0 && !sheet.report.includeAlreadyReported ? (
          <Alert status="warning" className="mb-4">
            <AlertDescription>
              {t(
                'staff.time_tracking.reports.detail.excludedHint',
                '{count} entries in this period are already frozen in another report and are excluded here ({hours}).',
              )
                .replace('{count}', String(sheet.alreadyReportedCount))
                .replace('{hours}', formatReportMinutes(sheet.alreadyReportedMinutes))}
            </AlertDescription>
          </Alert>
        ) : null}

        <ReportSheet
          reference={sheet.report.reference}
          customerName={sheet.report.customerName ?? sheet.report.title}
          periodLabel={`${sheet.report.periodFrom ?? ''} – ${sheet.report.periodTo ?? ''}`}
          issuedByLabel={null}
          issuedAtLabel={sheet.report.closedAt ? sheet.report.closedAt.slice(0, 10) : null}
          currencyCode={sheet.report.currencyCode}
          showRates={sheet.report.showRates && canSeeMoney}
          groups={sheet.groups}
          totals={{
            billableMinutes: sheet.totals.billableMinutes,
            nonbillableMinutes: sheet.totals.nonbillableMinutes,
            totalAmount: sheet.totals.totalAmount,
          }}
          roundingLabel={roundingLabel}
        />

        {isClosed ? (
          <section className="mt-6 rounded-lg border border-border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
              <h3 className="text-sm font-semibold">
                {t('staff.time_tracking.reports.locked.tableTitle', 'Locked entries')}
              </h3>
              <span className="font-mono text-xs text-muted-foreground">
                {t('staff.time_tracking.reports.locked.tableCount', '{count} entries · {hours}')
                  .replace('{count}', String(sheet.rowCount))
                  .replace('{hours}', formatReportMinutes(sheet.totals.billableMinutes))}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">
                      {t('staff.time_tracking.reports.export.date', 'Date')}
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      {t('staff.time_tracking.reports.export.task', 'Task')}
                    </th>
                    <th className="px-4 py-2 text-left font-medium">
                      {t('staff.time_tracking.reports.export.person', 'Person')}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {t('staff.time_tracking.reports.sheet.time', 'Time')}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {t('staff.time_tracking.reports.sheet.amount', 'Amount')}
                    </th>
                    <th className="w-10 px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => (
                    <tr key={row.entryId} className="border-b border-border/60 last:border-b-0">
                      <td className="px-4 py-2 text-muted-foreground">{row.date}</td>
                      <td className="px-4 py-2">{row.taskLabel}</td>
                      <td className="px-4 py-2">{row.personLabel}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{row.hours}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{money(row.amount)}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <Lock aria-hidden="true" className="size-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.rowsTruncated ? (
              <p className="border-t border-border p-3 text-xs text-muted-foreground">
                {t(
                  'staff.time_tracking.reports.locked.truncated',
                  'Showing the first {shown} of {total} entries — export the report for the full list.',
                )
                  .replace('{shown}', String(sheet.rows.length))
                  .replace('{total}', String(sheet.rowCount))}
              </p>
            ) : null}
          </section>
        ) : null}

        {sheet.events.length > 0 ? (
          <section className="mt-6">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('staff.time_tracking.reports.history.title', 'History')}
            </h3>
            <ReportHistory events={sheet.events} />
          </section>
        ) : null}

        <Dialog open={unlockOpen} onOpenChange={(open) => setUnlockOpen(open)}>
          <DialogContent
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void handleUnlock()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t('staff.time_tracking.reports.unlock.dialogTitle', 'Unlock {count} entries?').replace(
                  '{count}',
                  String(sheet.rowCount),
                )}
              </DialogTitle>
            </DialogHeader>
            {lastExport ? (
              <Alert status="warning">
                <AlertTitle>
                  {t('staff.time_tracking.reports.unlock.sentTitle', 'This report has already been exported')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    'staff.time_tracking.reports.unlock.sentBody',
                    'A file was downloaded on {date}. Changes to unlocked entries will diverge from the copy the client holds.',
                  ).replace('{date}', lastExport.createdAt?.slice(0, 10) ?? '')}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unlock-reason">
                {t('staff.time_tracking.reports.unlock.reason', 'Reason for unlocking')}
              </Label>
              <Textarea
                id="unlock-reason"
                value={unlockReason}
                onChange={(event) => setUnlockReason(event.target.value)}
                placeholder={t(
                  'staff.time_tracking.reports.unlock.reasonPlaceholder',
                  'e.g. the client disputed 4h on the refactor — correction agreed on the 21st.',
                )}
              />
              <span className="text-xs text-muted-foreground">
                {t(
                  'staff.time_tracking.reports.unlock.reasonHint',
                  'The reason is recorded in the report history with your name and the date.',
                )}
              </span>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setUnlockOpen(false)}>
                {t('staff.time_tracking.reports.unlock.cancel', 'Cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleUnlock()}
                disabled={busy || unlockReason.trim().length === 0}
              >
                <LockOpen aria-hidden="true" />
                {t('staff.time_tracking.reports.unlock.action', 'Unlock entries')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

function ReportHistory({ events }: { events: readonly ReportHistoryEvent[] }) {
  const t = useT()
  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {event.eventType === 'closed'
                ? t('staff.time_tracking.reports.history.closed', 'Closed the report and locked its entries.')
                : event.eventType === 'unlocked'
                  ? t('staff.time_tracking.reports.history.unlocked', 'Unlocked the report entries.')
                  : t('staff.time_tracking.reports.history.exported', 'Exported the report.')}
            </span>
            <span className="text-xs text-muted-foreground">{event.createdAt?.replace('T', ' ').slice(0, 16)}</span>
          </div>
          {event.reason ? <p className="mt-1 text-sm text-muted-foreground">{event.reason}</p> : null}
        </li>
      ))}
    </ol>
  )
}
