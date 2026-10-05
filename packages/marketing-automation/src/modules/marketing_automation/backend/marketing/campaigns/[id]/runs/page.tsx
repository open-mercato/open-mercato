"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useMarketingMutation } from '../../../../../components/useMarketingMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { RUN_STATUS_VARIANTS } from '../../../../../components/runStatus'

type StepEntry = { stepId: string; type: string; status: string; at: string; detail: string | null }

type RunRow = {
  id: string
  subjectEntityId: string | null
  subjectName: string | null
  subjectEmail: string | null
  triggerEventId: string
  triggerLabelKey: string | null
  status: string
  currentStepIndex: number
  attempts: number
  lastError: string | null
  startedAt: string
  resumeAt: string | null
  completedAt: string | null
  stepsDone: number
  stepsSkipped: number
  stepLog: StepEntry[]
  /**
   * Set only on the synthetic child rows the table nests under a run. The step log belongs under the
   * run somebody clicked — rendered after the table it was a panel at the bottom of the page, which on
   * any list longer than a screen reads as a button that does nothing.
   */
  stepEntry?: StepEntry
}

type RunsResponse = {
  campaign?: { id?: string; name?: string }
  items?: RunRow[]
  total?: number
}

/**
 * The funnel's stages, as the runs list understands them. Mirrors `ENGAGEMENTS` in the runs route.
 *
 * The wording matches the funnel's own stage labels, because the reader got here by clicking one of them and
 * a different word for the same stage reads as a different filter.
 */
const ENGAGEMENT_FILTERS = ['received', 'opened', 'clicked']
const ENGAGEMENT_LABELS: Record<string, string> = {
  received: 'Received a message',
  opened: 'Opened',
  clicked: 'Clicked',
}

const STATUS_FILTERS = ['waiting', 'running', 'completed', 'dead'] as const


export default function CampaignRunsPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const runMutation = useMarketingMutation('campaign_run')
  const scopeVersion = useOrganizationScopeVersion()
  const campaignId = typeof params?.id === 'string' ? params.id : ''

  const [rows, setRows] = React.useState<RunRow[]>([])
  const [campaignName, setCampaignName] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)
  /**
   * A failed request is not an empty list.
   *
   * `result.ok === false` used to fall through to `setRows([])`, so an expired session or a 500 rendered
   * "This campaign has not run yet." — the most reassuring possible lie about a campaign that may have been
   * messaging customers all night.
   */
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  /**
   * Which funnel stage these people are, when the reader arrived from one.
   *
   * Read from the URL rather than picked here, because it is a destination: the results screen counts a
   * stage and links to the people in it, and a link that lands on an unfiltered list has answered a
   * different question than the one that was clicked. It stays in the URL so the view can be shared.
   */
  const [engagement, setEngagement] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const fromUrl = new URLSearchParams(window.location.search).get('engagement')
    setEngagement(fromUrl && ENGAGEMENT_FILTERS.includes(fromUrl) ? fromUrl : null)
  }, [])

  const load = React.useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    setLoadError(null)
    try {
      const query = new URLSearchParams({ pageSize: '50' })
      if (status) query.set('status', status)
      if (engagement) query.set('engagement', engagement)
      const result = await apiCall<RunsResponse>(
        `/api/marketing_automation/campaigns/${campaignId}/runs?${query.toString()}`,
      )
      if (!result.ok || !Array.isArray(result.result?.items)) {
        setRows([])
        setLoadError(t('marketing_automation.runs.loadFailed', 'The runs could not be loaded.'))
        return
      }
      setRows(result.result.items)
      setCampaignName(result.result?.campaign?.name ?? '')
    } catch {
      setRows([])
      setLoadError(t('marketing_automation.runs.loadFailed', 'The runs could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [campaignId, status, engagement, t])

  React.useEffect(() => { void load() }, [load, scopeVersion])


  /**
   * Puts one dead run back in the queue — the only write this screen has.
   *
   * It ASKS first, because reviving a run resumes a journey and the next thing it does is send a message to a
   * named person. And it goes through `runMutation` because `AGENTS.md` requires every write on a page that
   * cannot use `CrudForm` to carry the platform's mutation guards; this page had no writes at all until now, so
   * both arrive together.
   */
  const retry = async (row: RunRow) => {
    const confirmed = await confirm({
      text: t(
        'marketing_automation.runs.confirmRetry',
        'Put this journey back in the queue? It carries on from the step that failed, which may send a message to this customer.',
      ),
    })
    if (!confirmed) return
    try {
      await runMutation(() => apiCallOrThrow(`/api/marketing_automation/campaigns/${campaignId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ runId: row.id }),
      }))
      await load()
      flash(t('marketing_automation.runs.retryQueued', 'Back in the queue. It resumes on the next pass.'), 'success')
    } catch {
      // The route answers 409 for a run that is no longer dead — somebody else revived it, or the list is stale.
      flash(t('marketing_automation.runs.retryFailed', 'Could not retry this journey. Refresh and check its status.'), 'error')
    }
  }

  const columns = React.useMemo<ColumnDef<RunRow>[]>(() => [
    {
      accessorKey: 'status',
      header: t('marketing_automation.runs.columns.status', 'Status'),
      // A badge is a shape, not prose: "Retrying after an error" was wider than the column and lost its end.
      meta: { truncate: false },
      /**
       * A run backing off after a FAILURE reads differently from one waiting on purpose.
       *
       * `failRun` stores `waiting` for both, and it has to: the resume scan looks for `status: 'waiting'` with a
       * due `resumeAt`, so storing anything else would mean a failed run never retried at all. But on screen the
       * two are opposite facts — a drip campaign between steps is healthy, a run on attempt three with an error
       * behind it is not — and the status filter could not tell them apart.
       *
       * Derived from data the row already carries rather than from a new column: attempts past the first, with an
       * error recorded, is a retry by definition.
       */
      cell: ({ row }) => {
        const { stepEntry } = row.original
        if (stepEntry) {
          return (
            <StatusBadge
              variant={stepEntry.status === 'done' ? 'success' : stepEntry.status === 'failed' ? 'error' : 'neutral'}
            >
              {t(`marketing_automation.runs.step.${stepEntry.status}`, stepEntry.status)}
            </StatusBadge>
          )
        }
        const retrying = row.original.status === 'waiting'
          && row.original.attempts > 0
          && Boolean(row.original.lastError)
        return (
          <StatusBadge variant={retrying ? 'error' : RUN_STATUS_VARIANTS[row.original.status] ?? 'neutral'} dot>
            {retrying
              ? t('marketing_automation.runs.status.retrying', 'Retrying after an error')
              : t(`marketing_automation.runs.status.${row.original.status}`, row.original.status)}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'subjectEntityId',
      header: t('marketing_automation.runs.columns.subject', 'Customer'),
      meta: { truncate: false },
      /**
       * Their name, and their email under it.
       *
       * This column used to print the first eight characters of the subject id. That is an answer to a
       * question nobody asks — somebody reading this list wants to know WHO is waiting, and two customers
       * called Nowak are told apart by the address, not by a uuid prefix. The link still goes to the
       * profile, so the id is never something anybody has to copy.
       */
      cell: ({ row }) => {
        const { subjectEntityId, subjectName, subjectEmail, stepEntry } = row.original
        if (stepEntry) {
          return (
            <span className="text-sm font-medium text-foreground">
              {t(`marketing_automation.step.${stepEntry.type}.label`, stepEntry.type)}
            </span>
          )
        }
        if (!subjectEntityId) return '—'
        return (
          <a
            className="block leading-tight underline"
            href={`/backend/marketing/customers/${subjectEntityId}`}
            title={t('marketing_automation.runs.openProfile', 'Open the customer profile')}
          >
            <span className="text-sm">
              {/* A run outlives its subject when the customer is erased or deleted, and the screen says
                  which of the two states it is rather than falling back to the id. */}
              {subjectName ?? t('marketing_automation.runs.subjectGone', 'Customer no longer on file')}
            </span>
            {subjectEmail ? <span className="block text-xs text-muted-foreground">{subjectEmail}</span> : null}
          </a>
        )
      },
    },
    {
      accessorKey: 'triggerEventId',
      header: t('marketing_automation.runs.columns.trigger', 'Trigger'),
      meta: { truncate: false },
      /**
       * "Customer registered", not `customers.person.created`.
       *
       * The event id is the engine's vocabulary and it stays in the title attribute for whoever is
       * debugging, which is a different person from whoever is reading this list. An id the catalogue does
       * not know falls back to itself — a campaign saved before a trigger was renamed should not render a
       * blank cell.
       */
      cell: ({ row }) => row.original.stepEntry ? (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.original.stepEntry.at)}</span>
      ) : (
        <span className="text-sm" title={row.original.triggerEventId}>
          {row.original.triggerLabelKey
            ? t(row.original.triggerLabelKey, row.original.triggerEventId)
            : row.original.triggerEventId}
        </span>
      ),
    },
    {
      accessorKey: 'stepsDone',
      header: t('marketing_automation.runs.columns.progress', 'Progress'),
      cell: ({ row }) => row.original.stepEntry
        ? <span className="text-sm text-muted-foreground">{row.original.stepEntry.detail ?? '—'}</span>
        : t('marketing_automation.runs.progressSummary', '{done} done, {skipped} skipped')
            .replace('{done}', String(row.original.stepsDone))
            .replace('{skipped}', String(row.original.stepsSkipped)),
    },
    {
      accessorKey: 'startedAt',
      meta: { truncate: false },
      header: t('marketing_automation.runs.columns.startedAt', 'Started'),
      cell: ({ row }) => (row.original.stepEntry ? '' : formatDateTime(row.original.startedAt)),
    },
    {
      accessorKey: 'resumeAt',
      meta: { truncate: false },
      header: t('marketing_automation.runs.columns.resumeAt', 'Resumes'),
      cell: ({ row }) => {
        if (row.original.stepEntry) return ''
        return row.original.resumeAt ? formatDateTime(row.original.resumeAt) : '—'
      },
    },
    {
      accessorKey: 'attempts',
      header: t('marketing_automation.runs.columns.attempts', 'Attempts'),
      cell: ({ row }) => (row.original.stepEntry ? '' : String(row.original.attempts)),
    },
    {
      id: 'actions',
      header: '',
      /**
       * Offered only for a DEAD run, because that is the only state a retry applies to.
       *
       * A running or waiting journey needs nothing from anybody, and a menu item that answers 409 would be a
       * button whose job is to be refused. The route checks the state again anyway — the list can be stale, and
       * two operators can press it together — but the screen should not invite the race.
       */
      cell: ({ row }) => {
        if (row.original.status !== 'dead') return null
        const actions: RowActionItem[] = [
          {
            id: 'retry',
            label: t('marketing_automation.runs.action.retry', 'Put back in the queue'),
            onSelect: () => { void retry(row.original) },
          },
        ]
        return <RowActions items={actions} />
      },
    },
  ], [t, retry])

  /**
   * The step log is rendered as child rows of its run, so it opens where it belongs: under the row
   * somebody clicked. A run with no step yet gets no toggle rather than an empty drawer.
   */
  const stepSubRows = React.useCallback(
    (row: RunRow) => (row.stepEntry || row.stepLog.length === 0
      ? undefined
      : row.stepLog.map((entry, index) => ({ ...row, id: `${row.id}:step:${index}`, stepEntry: entry }))),
    [],
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-3">
          {/* The numbers this list produces live one screen away; a run list with no way to reach
              them leaves the author counting rows by hand. */}
          <a className="text-sm underline" href={`/backend/marketing/campaigns/${campaignId}/results`}>
            {t('marketing_automation.results.title', 'Results')}
          </a>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {campaignName ? <div className="mr-auto text-sm font-medium text-foreground">{campaignName}</div> : null}
          {/* Mutually exclusive, so a segmented control rather than buttons flipping their own variant:
              five `default`/`outline` buttons only LOOK like a selection, and the one that is selected is
              told apart from the rest by weight alone. */}
          <SegmentedControl
            value={status ?? 'all'}
            onValueChange={(next) => setStatus(next === 'all' ? null : next)}
          >
            <SegmentedControlItem value="all">
              {t('marketing_automation.runs.filter.all', 'All')}
            </SegmentedControlItem>
            {STATUS_FILTERS.map((value) => (
              <SegmentedControlItem key={value} value={value}>
                {t(`marketing_automation.runs.status.${value}`, value)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>

        {/*
          Named, and removable, because arriving here filtered without being told is indistinguishable from
          a campaign that only ever reached nine people.
        */}
        {engagement ? (
          <div className="mb-3 flex items-center gap-2">
            <StatusBadge variant="info">
              {t(`marketing_automation.results.funnel.${engagement === 'received' ? 'sent' : engagement}`, ENGAGEMENT_LABELS[engagement] ?? engagement)}
            </StatusBadge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEngagement(null)
                if (typeof window !== 'undefined') {
                  const next = new URL(window.location.href)
                  next.searchParams.delete('engagement')
                  window.history.replaceState(null, '', next.toString())
                }
              }}
            >
              {t('marketing_automation.runs.engagement.clear', 'Show everybody who entered')}
            </Button>
          </div>
        ) : null}

        {loadError ? (
          <div className="mb-3">
            <ErrorMessage
              label={loadError}
              action={(
                <Button variant="outline" size="sm" onClick={() => { void load() }}>
                  {t('marketing_automation.runs.retry', 'Try again')}
                </Button>
              )}
            />
          </div>
        ) : null}

        {/* Not rendered after a failure: an empty table under the error would still say "has not run yet". */}
        {loadError ? null : (
        <DataTable
          title={t('marketing_automation.runs.title', 'Runs')}
          titleHeadingLevel={1}
          titleHelp={{
            title: t('marketing_automation.runs.title', 'Runs'),
            body: t('marketing_automation.help.page.runs'),
          }}
          columns={columns}
          data={rows}
          isLoading={loading}
          emptyState={(
            <ListEmptyState
              title={t('marketing_automation.runs.empty', 'This campaign has not run yet.')}
              description={t(
                'marketing_automation.runs.empty.description',
                'A run appears here for every customer the campaign starts for.',
              )}
            />
          )}
          getSubRows={stepSubRows}
          expandable={(row) => !row.stepEntry && row.stepLog.length > 0}
        />
        )}

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
