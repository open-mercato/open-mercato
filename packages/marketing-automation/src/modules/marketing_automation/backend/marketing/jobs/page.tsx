"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

const LIST_LIMIT = 100

type JobRow = {
  id: string
  kind: string
  campaignId: string | null
  startedAt: string
  finishedAt: string | null
  status: string
  counters: Record<string, number> | null
  error: string | null
}

const STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  ok: 'success',
  running: 'info',
  failed: 'error',
}

/**
 * What the background jobs have been doing.
 *
 * The screen for the morning-after question. A sweep that quietly stopped firing looks exactly like a sweep
 * with nothing to do — until this list shows the last one was on Friday.
 */
/**
 * A run that did nothing, and how many did nothing in a row before it.
 *
 * `idleRun` is set only on the collapsed summary rows.
 */
type JobDisplayRow = JobRow & { idleRun?: { count: number; oldestStartedAt: string } }

/**
 * Collapses consecutive runs that found no work into one row.
 *
 * The due-run scan fires every ninety seconds whether or not a journey is waiting, so an installation at rest
 * produced a screen of identical rows reading "completed, 0, 0, 0" for ever — every row saying nothing
 * happened, which answers neither question this page exists for. Deleting those rows instead would be worse:
 * "the scan ran and found nothing" and "the scan stopped running" would become indistinguishable, and telling
 * those two apart is the main reason to open this page at all.
 *
 * So they are summarised rather than hidden. The group keeps the newest run's own row, because that timestamp
 * is the proof the job is alive, and carries the count and the oldest start so the quiet stretch is legible.
 * Only a genuinely uneventful run collapses: anything with a counter above zero, an error, or a status other
 * than `ok` stays a row of its own.
 */
function collapseIdleRuns(rows: JobRow[]): JobDisplayRow[] {
  const didNothing = (row: JobRow): boolean => (
    row.status === 'ok'
    && !row.error
    && Object.values(row.counters ?? {}).every((value) => value === 0)
  )

  const out: JobDisplayRow[] = []
  for (const row of rows) {
    const previous = out[out.length - 1]
    if (previous && previous.kind === row.kind && didNothing(previous) && didNothing(row)) {
      previous.idleRun = {
        count: (previous.idleRun?.count ?? 1) + 1,
        oldestStartedAt: row.startedAt,
      }
      continue
    }
    out.push({ ...row })
  }
  return out
}

type DeadLetter = {
  id: string
  source: string
  eventId: string | null
  campaignId: string | null
  error: string
  createdAt: string
}

export default function MarketingJobsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<JobRow[]>([])
  const [truncated, setTruncated] = React.useState(false)
  /**
   * Dispatches that never ran, which until now nothing displayed.
   *
   * They were written to a table, pruned at thirty days, and never shown, while `lib/dead-letter.ts` argued —
   * correctly — that automatic replay is wrong because "replay belongs behind a person deciding". This is the
   * screen that person needed.
   */
  const [deadLetters, setDeadLetters] = React.useState<DeadLetter[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: JobRow[]; deadLetters?: DeadLetter[] }>('/api/marketing_automation/jobs?limit=100')
      /**
       * A non-ok response is not an empty list.
       *
       * `apiCall` resolves rather than throwing on 401/403/500, so the `catch` below only ever saw a
       * transport error — an expired session or a server fault fell through to an empty array and the page
       * rendered its "nothing here yet" state, which is the most reassuring possible lie.
       */
      if (!result.ok || !Array.isArray(result.result?.items)) {
        setRows([])
        setLoadFailed(true)
        return
      }
      setRows(result.result.items)
      setTruncated(result.result.items.length >= LIST_LIMIT)
      setDeadLetters(Array.isArray(result.result.deadLetters) ? result.result.deadLetters : [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const columns = React.useMemo<ColumnDef<JobDisplayRow>[]>(() => [
    {
      accessorKey: 'kind',
      header: t('marketing_automation.jobs.columns.kind', 'Job'),
      cell: ({ row }) => t(`marketing_automation.jobs.kind.${row.original.kind}`, row.original.kind),
    },
    {
      accessorKey: 'startedAt',
      header: t('marketing_automation.jobs.columns.startedAt', 'Started'),
      meta: { truncate: false },
      cell: ({ row }) => formatDateTime(row.original.startedAt),
    },
    {
      id: 'status',
      header: t('marketing_automation.jobs.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANTS[row.original.status] ?? 'neutral'}>
          {t(`marketing_automation.jobs.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      id: 'counters',
      header: t('marketing_automation.jobs.columns.counters', 'Result'),
      /**
       * The counters are the job's own vocabulary, so the labels carry the whole explanation.
       *
       * They used to read `checked: 8` — a key from the result blob with a number beside it, which is a
       * developer reading their own log. The counters themselves did not change; what they are CALLED did,
       * so the same row now reads "customers checked: 8" and needs no one to interpret it.
       */
      meta: { truncate: false },
      cell: ({ row }) => {
        const idle = row.original.idleRun
        if (idle) {
          return (
            <span className="text-xs text-muted-foreground">
              {t('marketing_automation.jobs.idleRuns', 'Nothing to do, {count} times in a row since {since}')
                .replace('{count}', String(idle.count))
                .replace('{since}', formatDateTime(idle.oldestStartedAt) ?? idle.oldestStartedAt)}
            </span>
          )
        }
        const counters = row.original.counters ?? {}
        const entries = Object.entries(counters)
        if (entries.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <span className="flex flex-wrap gap-1">
            {entries.map(([key, value]) => (
              <span key={key} className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
                {`${t(`marketing_automation.jobs.counter.${key}`, key)}: ${value}`}
              </span>
            ))}
          </span>
        )
      },
    },
    {
      id: 'campaign',
      header: t('marketing_automation.jobs.columns.campaign', 'Campaign'),
      cell: ({ row }) => (row.original.campaignId
        ? (
          <a className="underline" href={`/backend/marketing/campaigns/${row.original.campaignId}`}>
            {t('marketing_automation.jobs.openCampaign', 'Open')}
          </a>
        )
        : <span className="text-xs text-muted-foreground">—</span>),
    },
    {
      id: 'error',
      header: '',
      // Third-party failure text, so nothing here bounds its length but this.
      meta: { truncate: true, maxWidth: '320px' },
      cell: ({ row }) => (row.original.error
        ? <span className="text-xs text-status-error-text">{row.original.error}</span>
        : null),
    },
  ], [t])

  const displayRows = React.useMemo(() => collapseIdleRuns(rows), [rows])

  const deadLetterColumns = React.useMemo<ColumnDef<DeadLetter>[]>(() => [
    {
      id: 'source',
      header: t('marketing_automation.jobs.deadLetters.columns.source', 'Source'),
      // The source is a queue name, which is longer than the default column: truncating cuts the badge in half.
      meta: { truncate: false },
      cell: ({ row }) => <StatusBadge variant="error" dot>{row.original.source}</StatusBadge>,
    },
    {
      id: 'event',
      header: t('marketing_automation.jobs.deadLetters.columns.event', 'Event'),
      meta: { truncate: true, maxWidth: '220px' },
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.eventId ?? t('marketing_automation.jobs.deadLetters.noEvent', 'no event id')}
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('marketing_automation.jobs.columns.startedAt', 'Started'),
      meta: { truncate: false },
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: 'error',
      header: t('marketing_automation.jobs.deadLetters.columns.error', 'Error'),
      // Already redacted on the way in — this is third-party failure text, so nothing else bounds it.
      meta: { truncate: true, maxWidth: '320px' },
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.error}</span>,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <div className="mb-3 flex justify-end">
          <Button variant="outline" onClick={() => void load()}>
            {t('marketing_automation.jobs.refresh', 'Refresh')}
          </Button>
        </div>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage
              label={t('marketing_automation.jobs.loadFailed', 'Could not load the job history.')}
              action={(
                <Button variant="outline" size="sm" onClick={() => { void load() }}>
                  {t('marketing_automation.jobs.retry', 'Try again')}
                </Button>
              )}
            />
          </div>
        ) : null}
        {/*
          Dispatches that never ran, above the log of the ones that did.
          
          Shown only when there are some: a healthy installation has nothing here and should not be handed an
          empty panel to interpret. No replay button, deliberately — `lib/dead-letter.ts` argues that a dispatch
          which failed for a reason nobody has read should not be retried by a timer, and that argument applies
          just as much to a button somebody clicks without reading. What was missing was the seeing, not the
          retrying.
        */}
        {!loadFailed && deadLetters.length > 0 ? (
          <div className="mb-4 space-y-2">
            <SectionHeader
              title={t('marketing_automation.jobs.deadLetters.title', 'Dispatches that never ran')}
              count={deadLetters.length}
              help={{
                title: t('marketing_automation.jobs.deadLetters.title', 'Dispatches that never ran'),
                body: t('marketing_automation.help.jobs.deadLetters'),
              }}
            />
            {/* A table, like the job log directly beneath it: two lists of the same kind of thing on one
                screen, rendered two different ways, read as two unrelated features. */}
            <DataTable columns={deadLetterColumns} data={deadLetters} />
          </div>
        ) : null}
        {/* Not under the error: an empty table there would still make a claim about data nobody read. */}
        {loadFailed ? null : (
          <DataTable
            title={t('marketing_automation.jobs.title', 'Background jobs')}
            titleHeadingLevel={1}
            titleHelp={{
              title: t('marketing_automation.jobs.title', 'Background jobs'),
              body: t('marketing_automation.help.page.jobs'),
            }}
            columns={columns}
            data={displayRows}
            isLoading={loading}
            emptyState={(
              <ListEmptyState
                title={t('marketing_automation.jobs.emptyTitle', 'No job runs recorded yet')}
                description={t('marketing_automation.jobs.emptyBody', 'Scheduled campaigns and waiting journeys are processed in the background. Each pass appears here with what it did.')}
              />
            )}
          />
        )}
        {truncated ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {t('marketing_automation.list.truncated', 'This screen lists at most {count} — there are probably more. Narrow what you are looking for rather than scrolling.')
              .replace('{count}', String(LIST_LIMIT))}
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
