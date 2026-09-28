"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type ReferralRow = {
  customerId: string
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
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: ReferralRow[] }>('/api/marketing_automation/referrals?limit=100')
      setRows(result.ok && Array.isArray(result.result?.items) ? result.result.items : [])
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
      cell: ({ row }) => (
        <a className="underline" href={`/backend/marketing/customers/${row.original.customerId}`}>
          {t('marketing_automation.referrals.openProfile', 'Open profile')}
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
            <ErrorMessage label={t('marketing_automation.referrals.loadFailed', 'Could not load the referral codes.')} />
          </div>
        ) : null}
        <DataTable
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
      </PageBody>
    </Page>
  )
}
