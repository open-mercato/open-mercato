"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type StepEntry = { stepId: string; type: string; status: string; at: string; detail: string | null }

type RunRow = {
  id: string
  subjectEntityId: string | null
  triggerEventId: string
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

  const columns = React.useMemo<ColumnDef<RunRow>[]>(() => [
    {
      accessorKey: 'status',
      header: t('marketing_automation.runs.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'} dot>
          {t(`marketing_automation.runs.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'subjectEntityId',
      header: t('marketing_automation.runs.columns.subject', 'Customer'),
      // Links to the profile: the run list is where somebody asks "who is this and why are we
      // messaging them", and the answer is one screen away rather than a uuid to copy.
      cell: ({ row }) => row.original.subjectEntityId
        ? (
          <a
            className="font-mono text-xs underline"
            href={`/backend/marketing/customers/${row.original.subjectEntityId}`}
            title={t('marketing_automation.runs.openProfile', 'Open the customer profile')}
          >
            {row.original.subjectEntityId.slice(0, 8)}
          </a>
        )
        : '—',
    },
    {
      accessorKey: 'triggerEventId',
      header: t('marketing_automation.runs.columns.trigger', 'Trigger'),
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.triggerEventId}</span>,
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
      header: t('marketing_automation.runs.columns.startedAt', 'Started'),
      cell: ({ row }) => formatDateTime(row.original.startedAt),
    },
    {
      accessorKey: 'resumeAt',
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
  ], [t, expanded])

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

        {openRun ? (
          <div className="mt-4 rounded-md border border-border bg-card p-3">
            <div className="mb-2 text-overline text-muted-foreground">
              {t('marketing_automation.runs.action.steps', 'Steps')}
            </div>
            {openRun.lastError ? (
              <div className="mb-2 text-xs text-status-error-base">
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
      </PageBody>
    </Page>
  )
}
