"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type Props = { params: { orgSlug: string } }

type AbstractRow = {
  id: string
  abstractNumber: string
  periodFrom: string
  periodTo: string
  status: string
  currencyCode: string
  tripCount: number
  grandTotalGrossAmount: string
  submittedAt: string | null
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (status === 'approved' || status === 'invoiced') return 'success'
  if (status === 'disputed') return 'warning'
  if (status === 'cancelled') return 'error'
  if (status === 'submitted') return 'info'
  return 'neutral'
}

export default function PortalFreightAbstractsPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<AbstractRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const basePath = `/${params.orgSlug}/portal/freight/abstracts`

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiCall<{ items?: AbstractRow[] }>('/api/portal/freight/abstracts')
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          setRows(Array.isArray(response.result.items) ? response.result.items : [])
          return
        }
        setError(t('freight_operations.portal.abstracts.loadError', 'Failed to load your trip abstracts.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('freight_operations.portal.abstracts.loadError', 'Failed to load your trip abstracts.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        label={t('freight_operations.portal.abstracts.title', 'Trip abstracts')}
        title={t('freight_operations.portal.abstracts.heading', 'Your transport billing')}
      />
      <DataTable<AbstractRow>
        title={t('freight_operations.portal.abstracts.title', 'Trip abstracts')}
        columns={[
          {
            id: 'number',
            header: t('freight_operations.portal.abstracts.number', 'Abstract'),
            accessorFn: (row) => row.abstractNumber,
          },
          {
            id: 'period',
            header: t('freight_operations.portal.abstracts.period', 'Period'),
            accessorFn: (row) => `${row.periodFrom?.slice(0, 10)} – ${row.periodTo?.slice(0, 10)}`,
          },
          {
            id: 'status',
            header: t('freight_operations.portal.abstracts.status', 'Status'),
            cell: ({ row }) => (
              <StatusBadge variant={statusVariant(row.original.status)} dot>
                {t(`freight_operations.abstracts.status.${row.original.status}`, row.original.status)}
              </StatusBadge>
            ),
          },
          {
            id: 'total',
            header: t('freight_operations.portal.abstracts.total', 'Total'),
            accessorFn: (row) => `${row.grandTotalGrossAmount} ${row.currencyCode}`,
          },
          {
            id: 'submittedAt',
            header: t('freight_operations.portal.abstracts.submittedAt', 'Submitted'),
            accessorFn: (row) => formatDateTime(row.submittedAt) ?? '',
          },
        ]}
        data={rows}
        isLoading={loading}
        error={error ?? undefined}
        emptyState={t('freight_operations.portal.abstracts.empty', 'No trip abstracts have been submitted yet.')}
        onRowClick={(row) => router.push(`${basePath}/${row.id}`)}
        rowActions={(row) => []}
      />
    </div>
  )
}
