"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useMarketingMutation } from '../../../../../components/useMarketingMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

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
}

type RunsResponse = {
  campaign?: { id?: string; name?: string }
  items?: RunRow[]
  total?: number
}

const STATUS_FILTERS = ['waiting', 'running', 'completed', 'dead'] as const

/**
 * A run's status is one of the few genuinely status-shaped values in this module, so it uses the DS
 * status tokens rather than colours of its own. `dead` and `failed` are errors because a customer is
 * stranded mid-journey; `waiting` is a warning rather than an error because it is the normal state
 * of a drip campaign between steps.
 */
/**
 * The statuses a run row can actually hold.
 *
 * `failed` is kept although `failRun` never writes it to a RUN — `marketing_job_runs` uses that word, and a
 * reader comparing the two screens should not find one of them silently falling through to `neutral` if the
 * vocabularies are ever unified. A retry is not here because it is not stored: see the status cell below.
 */
const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  running: 'info',
  claimed: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'error',
  dead: 'error',
}

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
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    setLoadError(null)
    try {
      const query = new URLSearchParams({ pageSize: '50' })
      if (status) query.set('status', status)
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
  }, [campaignId, status, t])

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
        const retrying = row.original.status === 'waiting'
          && row.original.attempts > 0
          && Boolean(row.original.lastError)
        return (
          <StatusBadge variant={retrying ? 'error' : STATUS_VARIANT[row.original.status] ?? 'neutral'} dot>
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
        const { subjectEntityId, subjectName, subjectEmail } = row.original
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
      cell: ({ row }) => (
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
      cell: ({ row }) => t('marketing_automation.runs.progressSummary', '{done} done, {skipped} skipped')
        .replace('{done}', String(row.original.stepsDone))
        .replace('{skipped}', String(row.original.stepsSkipped)),
    },
    {
      accessorKey: 'startedAt',
      meta: { truncate: false },
      header: t('marketing_automation.runs.columns.startedAt', 'Started'),
      cell: ({ row }) => formatDateTime(row.original.startedAt),
    },
    {
      accessorKey: 'resumeAt',
      meta: { truncate: false },
      header: t('marketing_automation.runs.columns.resumeAt', 'Resumes'),
      cell: ({ row }) => (row.original.resumeAt ? formatDateTime(row.original.resumeAt) : '—'),
    },
    {
      accessorKey: 'attempts',
      header: t('marketing_automation.runs.columns.attempts', 'Attempts'),
    },
    {
      id: 'detail',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(expanded === row.original.id ? null : row.original.id)}
        >
          {t('marketing_automation.runs.action.steps', 'Steps')}
        </Button>
      ),
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
  ], [t, expanded, retry])

  const openRun = rows.find((row) => row.id === expanded) ?? null

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
          <Button variant={status === null ? 'default' : 'outline'} size="sm" onClick={() => setStatus(null)}>
            {t('marketing_automation.runs.filter.all', 'All')}
          </Button>
          {STATUS_FILTERS.map((value) => (
            <Button
              key={value}
              variant={status === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatus(value)}
            >
              {t(`marketing_automation.runs.status.${value}`, value)}
            </Button>
          ))}
        </div>

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
        />
        )}

        {openRun ? (
          <div className="mt-4 rounded-md border border-border bg-card p-3">
            <div className="mb-2 text-overline text-muted-foreground">
              {t('marketing_automation.runs.action.steps', 'Steps')}
            </div>
            {openRun.lastError ? (
              <div className="mb-2 text-xs text-status-error-text">
                {t('marketing_automation.runs.columns.lastError', 'Last error')}: {openRun.lastError}
              </div>
            ) : null}
            {openRun.stepLog.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.runs.noSteps', 'No step has run yet.')}
              </div>
            ) : (
              <ol className="space-y-1">
                {openRun.stepLog.map((entry, index) => (
                  <li key={`${entry.stepId}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge
                      variant={entry.status === 'done' ? 'success' : entry.status === 'failed' ? 'error' : 'neutral'}
                    >
                      {t(`marketing_automation.runs.step.${entry.status}`, entry.status)}
                    </StatusBadge>
                    <span className="font-medium text-foreground">
                      {t(`marketing_automation.step.${entry.type}.label`, entry.type)}
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(entry.at)}</span>
                    {entry.detail ? <span className="text-muted-foreground">— {entry.detail}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
