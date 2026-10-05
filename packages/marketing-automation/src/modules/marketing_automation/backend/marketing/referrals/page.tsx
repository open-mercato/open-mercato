"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

const LIST_LIMIT = 100

type ReferralRow = {
  customerId: string
  /** Null when the caller may not read customer names, which is a permission rather than a missing person. */
  customerName: string | null
  code: string
  url: string | null
  claimed: number
  converted: number
  createdAt: string
}

/**
 * Who is bringing customers in.
 *
 * Ordered by conversions, which is the endpoint's own ordering and the only one that answers the question
 * people open this screen with — a list by issue date would be a list of who happened to get a code first.
 */
export default function ReferralsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<ReferralRow[]>([])
  const [truncated, setTruncated] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: ReferralRow[] }>('/api/marketing_automation/referrals?limit=100')
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
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const columns = React.useMemo<ColumnDef<ReferralRow>[]>(() => [
    {
      accessorKey: 'code',
      header: t('marketing_automation.referrals.columns.code', 'Code'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      id: 'customer',
      header: t('marketing_automation.referrals.columns.customer', 'Referrer'),
      /**
       * The person's name, not the words "Open profile" on every row.
       *
       * A column whose every cell reads the same cannot answer the question the screen is for — who brings
       * customers in — and the only way to find out used to be opening each row in turn. The generic label
       * stays as the fallback for a caller who may not read customer names, where it is the honest thing to
       * show.
       */
      cell: ({ row }) => (
        <a className="underline" href={`/backend/marketing/customers/${row.original.customerId}`}>
          {row.original.customerName ?? t('marketing_automation.referrals.openProfile', 'Open profile')}
        </a>
      ),
    },
    {
      accessorKey: 'claimed',
      header: t('marketing_automation.referrals.columns.claimed', 'Used the code'),
      cell: ({ row }) => <span className="tabular-nums">{row.original.claimed}</span>,
    },
    {
      accessorKey: 'converted',
      header: t('marketing_automation.referrals.columns.converted', 'Bought'),
      cell: ({ row }) => <span className="tabular-nums font-medium">{row.original.converted}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: t('marketing_automation.referrals.columns.createdAt', 'Issued'),
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage
              label={t('marketing_automation.referrals.loadFailed', 'Could not load the referral codes.')}
              action={(
                <Button variant="outline" size="sm" onClick={() => { void load() }}>
                  {t('marketing_automation.referrals.retry', 'Try again')}
                </Button>
              )}
            />
          </div>
        ) : null}
        {/* Not under the error: an empty table there would still make a claim about data nobody read. */}
        {loadFailed ? null : (
          <DataTable
            title={t('marketing_automation.referrals.title', 'Referrals')}
            titleHeadingLevel={1}
            titleHelp={{
              title: t('marketing_automation.referrals.title', 'Referrals'),
              body: t('marketing_automation.help.page.referrals'),
            }}
            columns={columns}
            data={rows}
            isLoading={loading}
            emptyState={(
              <ListEmptyState
                title={t('marketing_automation.referrals.emptyTitle', 'No referral codes issued yet')}
                description={t('marketing_automation.referrals.emptyBody', 'Add the "Issue a referral code" step to a campaign. It writes {{referral.code}} into the message, and a code converts when somebody who used it places their first order.')}
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
