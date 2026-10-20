"use client"

import * as React from 'react'
import { History } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { XRAY_API_BASE } from '../../lib/client/xray/api'
import { formatCount, formatXrayDateTime } from '../../lib/client/xray/format'
import type { XrayStatusResponse } from '../../lib/client/xray/types'
import { XrayTabResource } from './tabs/shared'
import { describeXrayError } from './XrayErrorNotice'
import { readMutationError, useXrayMutations, useXrayResource } from '../../lib/client/xray/hooks'

export const XRAY_STATUS_CONTEXT_ID = 'insights-xray:status'
const POLL_WHILE_SCANNING_MS = 5000

type ProcessRow = XrayStatusResponse['processes'][number] & { labelKey: string | null }

function isScanning(status: XrayStatusResponse | null): boolean {
  return Boolean(status?.cursor && (status.cursor.status === 'backfilling' || status.cursor.scan))
}

/**
 * Operational status of the selected organization's projection (how far it is, history
 * coverage, a running scan, the last error, per-process counts) and the "Backfill history"
 * action. The backfill runs as a progress job shown in the top bar; the panel refreshes when
 * that job reports progress and while a scan runs.
 */
export function XrayStatusPanel() {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { startBackfill } = useXrayMutations(XRAY_STATUS_CONTEXT_ID)
  const resource = useXrayResource<XrayStatusResponse>(`${XRAY_API_BASE}/status`)
  const [starting, setStarting] = React.useState(false)
  const [progressJobId, setProgressJobId] = React.useState<string | null>(null)
  const status = resource.data
  const scanning = isScanning(status)
  const reload = resource.reload

  React.useEffect(() => {
    if (!scanning) return
    const timer = setInterval(reload, POLL_WHILE_SCANNING_MS)
    return () => clearInterval(timer)
  }, [reload, scanning])

  useAppEvent('progress.job.updated', (event) => {
    const payload = event.payload as { jobId?: unknown } | null
    const jobId = typeof payload?.jobId === 'string' ? payload.jobId : null
    const tracked = progressJobId ?? status?.cursor?.scan?.progressJobId ?? null
    if (jobId && tracked && jobId === tracked) reload()
  }, [progressJobId, reload, status?.cursor?.scan?.progressJobId])

  const handleBackfill = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('insights.xray.ui.status.backfillConfirmTitle'),
      text: t('insights.xray.ui.status.backfillConfirmText'),
      confirmText: t('insights.xray.ui.status.backfill'),
    })
    if (!confirmed) return
    setStarting(true)
    try {
      const started = await startBackfill()
      setProgressJobId(started.progressJobId)
      flash(t('insights.xray.ui.status.backfillStarted'), 'success')
      reload()
    } catch (error) {
      const { code } = readMutationError(error)
      flash(describeXrayError({ httpStatus: null, code, hint: null, message: null }, t, 'insights.xray.ui.status.backfillFailed'), 'error')
    } finally {
      setStarting(false)
    }
  }, [confirm, reload, startBackfill, t])

  const columns = React.useMemo<ColumnDef<ProcessRow>[]>(() => [
    { id: 'process', header: t('insights.xray.ui.status.columns.process'), cell: ({ row }) => (row.original.labelKey ? t(row.original.labelKey) : row.original.processKey) },
    { id: 'events', header: t('insights.xray.ui.status.columns.events'), cell: ({ row }) => (row.original.n === null ? '—' : formatCount(row.original.n, locale)) },
    { id: 'cases', header: t('insights.xray.ui.status.columns.cases'), cell: ({ row }) => (row.original.cases === null ? '—' : formatCount(row.original.cases, locale)) },
    { id: 'openCases', header: t('insights.xray.ui.status.columns.openCases'), cell: ({ row }) => (row.original.openCases === null ? '—' : formatCount(row.original.openCases, locale)) },
    { id: 'last', header: t('insights.xray.ui.status.columns.lastActivity'), cell: ({ row }) => formatXrayDateTime(row.original.lastOccurredAt, locale) ?? '—' },
  ], [locale, t])

  return (
    <section className="space-y-3" data-testid="xray-status-panel">
      {ConfirmDialogElement}
      <SectionHeader
        title={t('insights.xray.ui.status.title')}
        action={(
          <Button type="button" variant="outline" onClick={() => { void handleBackfill() }} disabled={starting || scanning} data-testid="xray-backfill">
            <History className="size-4" aria-hidden="true" />
            {t('insights.xray.ui.status.backfill')}
          </Button>
        )}
      />
      <XrayTabResource resource={resource}>
        {(data) => {
          const cursor = data.cursor
          const labels = new Map(data.registry.processes.map((process) => [process.processKey, process.labelKey]))
          const rows: ProcessRow[] = data.processes.map((process) => ({ ...process, labelKey: labels.get(process.processKey) ?? null }))
          return (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge variant={data.ingestEnabled && data.settings.enabled ? 'success' : 'neutral'} dot>
                  {data.ingestEnabled && data.settings.enabled ? t('insights.xray.ui.status.active') : t('insights.xray.ui.status.inactive')}
                </StatusBadge>
                {cursor ? (
                  <StatusBadge variant={scanning ? 'info' : 'neutral'} dot>
                    {scanning ? t('insights.xray.ui.status.scanning') : t('insights.xray.ui.status.idle')}
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="warning" dot>{t('insights.xray.ui.status.notEnrolled')}</StatusBadge>
                )}
              </div>
              {!data.ingestEnabled ? <p className="text-xs text-muted-foreground">{t('insights.xray.ui.status.killSwitch')}</p> : null}
              {cursor ? (
                <dl className="grid gap-2 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('insights.xray.ui.status.computedThrough')}</dt>
                    <dd>{formatXrayDateTime(cursor.computedThrough, locale) ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('insights.xray.ui.status.coverageFrom')}</dt>
                    <dd>
                      {formatXrayDateTime(cursor.coverageFrom, locale) ?? '—'}
                      {' '}
                      <span className="text-xs text-muted-foreground">
                        {cursor.historyScanned ? t('insights.xray.ui.status.historyScanned') : t('insights.xray.ui.status.historyMissing')}
                      </span>
                    </dd>
                  </div>
                  {cursor.scan ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('insights.xray.ui.status.scan')}</dt>
                      <dd>{t(`insights.xray.ui.status.scanKind.${cursor.scan.kind}`)} — {t('insights.xray.ui.status.scanProcessed', { count: formatCount(cursor.scan.processed, locale) })}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('insights.xray.ui.status.lastRun')}</dt>
                    <dd>{formatXrayDateTime(cursor.lastRunAt, locale) ?? '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">{t('insights.xray.ui.status.notEnrolledHelp')}</p>
              )}
              {cursor?.lastError ? (
                <Alert status="error" size="default">
                  <AlertTitle>{t('insights.xray.ui.status.lastError')}</AlertTitle>
                  <AlertDescription className="font-mono text-xs">{cursor.lastError}</AlertDescription>
                </Alert>
              ) : null}
              {cursor && cursor.rebuildingProcessKeys.length > 0 ? (
                <p className="text-xs text-muted-foreground">{t('insights.xray.ui.status.rebuilding', { processes: cursor.rebuildingProcessKeys.join(', ') })}</p>
              ) : null}
              {cursor && cursor.undecryptableRows > 0 ? (
                <p className="text-xs text-muted-foreground">{t('insights.xray.ui.status.undecryptable', { count: formatCount(cursor.undecryptableRows, locale) })}</p>
              ) : null}
              {data.countsTimedOut ? <p className="text-xs text-muted-foreground">{t('insights.xray.ui.status.countsTimedOut')}</p> : null}
              <DataTable<ProcessRow>
                embedded
                columns={columns}
                data={rows}
                emptyState={<EmptyState variant="subtle" size="sm" title={t('insights.xray.ui.status.noProcesses')} />}
              />
            </>
          )
        }}
      </XrayTabResource>
    </section>
  )
}
