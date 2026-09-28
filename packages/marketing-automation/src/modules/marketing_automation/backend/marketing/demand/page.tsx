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

type DemandRow = { sku: string; watchers: number; notified: number }

/**
 * What customers are waiting to get cheaper.
 *
 * Demand that has declared itself: each row is a product somebody asked to be told about. Ordered by how many
 * people are waiting, which is the only ordering that answers "what should we discount next".
 */
export default function PriceWatchDemandPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<DemandRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<{ items?: DemandRow[] }>('/api/marketing_automation/watches?limit=200')
      setRows(result.ok && Array.isArray(result.result?.items) ? result.result.items : [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const columns = React.useMemo<ColumnDef<DemandRow>[]>(() => [
    {
      accessorKey: 'sku',
      header: t('marketing_automation.demand.columns.sku', 'Product'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
    },
    {
      accessorKey: 'watchers',
      header: t('marketing_automation.demand.columns.watchers', 'Waiting'),
      cell: ({ row }) => <span className="tabular-nums font-medium">{row.original.watchers}</span>,
    },
    {
      accessorKey: 'notified',
      header: t('marketing_automation.demand.columns.notified', 'Already told'),
      cell: ({ row }) => <span className="tabular-nums">{row.original.notified}</span>,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.demand.loadFailed', 'Could not load the price watches.')} />
          </div>
        ) : null}
        <div className="mb-3 text-xs text-muted-foreground">
          {t('marketing_automation.demand.hint', 'A customer watching a product is the clearest signal a shop gets. A drop of 5% or more starts the campaign triggered by "Watched product price dropped".')}
        </div>
        <DataTable
          columns={columns}
          data={rows}
          isLoading={loading}
          emptyState={(
            <ListEmptyState
              title={t('marketing_automation.demand.emptyTitle', 'Nobody is watching a product yet')}
              description={t('marketing_automation.demand.emptyBody', 'Watches are created through the API — a storefront or an app calls it when a customer asks to be told about a price.')}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
