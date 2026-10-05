"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type RequestRow = {
  id: string
  hookId: string
  subjectEntityId: string | null
  outcome: string
  body: Record<string, unknown> | null
  bodyBytes: number
  receivedAt: string
  /** Set only on the synthetic child row that shows the body under its request. */
  isBody?: boolean
}

/**
 * An outcome is not a failure: a request that named nobody this installation knows was still delivered and
 * still answered 202. Only the two that reached nobody read as something to look at.
 */
const OUTCOME_VARIANTS: Record<string, StatusBadgeVariant> = {
  'identified': 'success',
  'no matching customer': 'warning',
  'no customerId or email in the payload': 'warning',
}

/**
 * What outside systems actually posted.
 *
 * The hook row carries three counters — how many came, when, how the last one ended — which answers "is
 * anything arriving" and nothing else. When a partner says they sent it and no campaign ran, the counters
 * cannot settle the argument; this can, because it keeps the body.
 *
 * That is also why the rows are short-lived and why the screen is gated on managing campaigns rather than
 * viewing them: what is kept here is somebody else's data, held only as long as a debugging question stays
 * worth answering.
 */
export default function InboundRequestsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<RequestRow[]>([])
  const [retentionDays, setRetentionDays] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: RequestRow[]; retentionDays?: number }>(
        '/api/marketing_automation/inbound-requests?pageSize=100',
      )
      // A non-ok response is not an empty log: `apiCall` resolves on 401/403/500, and an empty table here
      // would claim nothing has ever arrived.
      if (!result.ok || !Array.isArray(result.result?.items)) {
        setRows([])
        setLoadFailed(true)
        return
      }
      setRows(result.result.items)
      setRetentionDays(typeof result.result.retentionDays === 'number' ? result.result.retentionDays : null)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const columns = React.useMemo<ColumnDef<RequestRow>[]>(() => [
    {
      id: 'receivedAt',
      header: t('marketing_automation.inboundRequests.columns.receivedAt', 'Received'),
      meta: { truncate: false },
      cell: ({ row }) => (row.original.isBody ? '' : formatDateTime(row.original.receivedAt)),
    },
    {
      id: 'outcome',
      header: t('marketing_automation.inboundRequests.columns.outcome', 'Outcome'),
      /**
       * A badge is a shape, not prose, so it is never truncated.
       *
       * The default column width clipped "no matching customer" and "no customerId or email" through the
       * badge's own right edge — mid-word, with no ellipsis, because the overflow is hidden on the cell rather
       * than on the text. Half a rounded pill reads as a rendering fault, and the outcome is the one thing
       * this column exists to say.
       */
      meta: { truncate: false },
      cell: ({ row }) => {
        if (row.original.isBody) return ''
        return (
          <StatusBadge variant={OUTCOME_VARIANTS[row.original.outcome] ?? 'neutral'} dot>
            {t(`marketing_automation.inboundRequests.outcome.${row.original.outcome}`, row.original.outcome)}
          </StatusBadge>
        )
      },
    },
    {
      id: 'customer',
      header: t('marketing_automation.inboundRequests.columns.customer', 'Customer'),
      meta: { truncate: true, maxWidth: '240px' },
      cell: ({ row }) => {
        if (row.original.isBody) {
          // The body, under the request it arrived in.
          return (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-3 text-xs leading-relaxed">
              {row.original.body
                ? JSON.stringify(row.original.body, null, 2)
                : t('marketing_automation.inboundRequests.noBody', 'Nothing usable arrived in the body.')}
            </pre>
          )
        }
        if (!row.original.subjectEntityId) {
          return (
            <span className="text-sm text-muted-foreground">
              {t('marketing_automation.inboundRequests.noCustomer', 'Nobody matched')}
            </span>
          )
        }
        return (
          <a className="text-sm underline" href={`/backend/marketing/customers/${row.original.subjectEntityId}`}>
            {t('marketing_automation.inboundRequests.openProfile', 'Open the profile')}
          </a>
        )
      },
    },
    {
      id: 'bodyBytes',
      header: t('marketing_automation.inboundRequests.columns.size', 'Size'),
      meta: { truncate: false },
      cell: ({ row }) => (row.original.isBody
        ? ''
        : <span className="text-xs tabular-nums text-muted-foreground">{`${row.original.bodyBytes} B`}</span>),
    },
  ], [t])

  /** The body opens under the request somebody clicked, the way a run's steps open under their run. */
  const bodySubRows = React.useCallback(
    (row: RequestRow) => (row.isBody ? undefined : [{ ...row, id: `${row.id}:body`, isBody: true }]),
    [],
  )

  return (
    <Page>
      <PageBody>
        {loadFailed ? (
          <ErrorMessage
            label={t('marketing_automation.inboundRequests.loadFailed', 'Could not load the inbound requests.')}
            action={(
              <Button variant="outline" size="sm" onClick={() => { void load() }}>
                {t('marketing_automation.runs.retry', 'Try again')}
              </Button>
            )}
          />
        ) : (
          <>
            <DataTable
              title={t('marketing_automation.inboundRequests.title', 'Inbound requests')}
              titleHeadingLevel={1}
              titleHelp={{
                title: t('marketing_automation.inboundRequests.title', 'Inbound requests'),
                body: t('marketing_automation.help.page.inboundRequests'),
              }}
              columns={columns}
              data={rows}
              isLoading={loading}
              getSubRows={bodySubRows}
              expandable={(row) => !row.isBody}
              emptyState={(
                <ListEmptyState
                  title={t('marketing_automation.inboundRequests.emptyTitle', 'Nothing has arrived yet')}
                  description={t(
                    'marketing_automation.inboundRequests.emptyBody',
                    'A request appears here the moment an outside system posts to one of your hooks.',
                  )}
                />
              )}
            />
            {/* Said on the screen rather than only in the help: somebody looking for last month's request
                should learn it is gone, not conclude it never arrived. */}
            {retentionDays !== null ? (
              <div className="mt-2 text-xs text-muted-foreground">
                {t('marketing_automation.inboundRequests.retention', 'Requests are deleted after {count} days.')
                  .replace('{count}', String(retentionDays))}
              </div>
            ) : null}
          </>
        )}
      </PageBody>
    </Page>
  )
}
