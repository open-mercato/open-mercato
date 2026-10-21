'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'

const RESOURCE = 'saudi_localization/zatca/submissions'

type SubmissionRow = {
  id: string
  order_id: string
  invoice_number: string
  icv: number
  status: 'pending' | 'submitted' | 'cleared' | 'rejected'
  created_at?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_FALLBACKS: Record<string, string> = {
  pending: 'Pending',
  submitted: 'Submitted',
  cleared: 'Cleared',
  rejected: 'Rejected',
}

export default function ZatcaSubmissionsPage() {
  const t = useT()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const statusFilter = typeof values.status === 'string' ? values.status : undefined

  const query = useQuery({
    queryKey: ['saudi-zatca-submissions', search, statusFilter, page],
    queryFn: () => fetchCrudList<SubmissionRow>(RESOURCE, {
      page,
      pageSize: 50,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      sortField: 'icv',
      sortDir: 'desc',
    }),
  })
  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<SubmissionRow>[]>(() => [
    { accessorKey: 'invoice_number', header: t('saudi_localization.submissions.columns.invoice', 'Invoice'), cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '')}</span> },
    { accessorKey: 'icv', header: t('saudi_localization.submissions.columns.icv', 'ICV'), cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '')}</span> },
    { accessorKey: 'order_id', header: t('saudi_localization.submissions.columns.order', 'Sales order'), cell: ({ getValue }) => <Link className="font-mono text-xs underline" href={`/backend/sales/orders/${String(getValue() ?? '')}`}>{String(getValue() ?? '').slice(0, 8)}</Link> },
    {
      accessorKey: 'status',
      header: t('saudi_localization.submissions.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const status = String(getValue() ?? 'pending')
        return <Badge variant={status === 'rejected' ? 'destructive' : status === 'pending' ? 'outline' : 'default'}>{t(`saudi_localization.submissions.status.${status}`, STATUS_FALLBACKS[status] ?? status)}</Badge>
      },
    },
    { accessorKey: 'created_at', header: t('saudi_localization.submissions.columns.created', 'Created'), cell: ({ getValue }) => <span className="text-xs">{String(getValue() ?? '').slice(0, 19).replace('T', ' ')}</span> },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('saudi_localization.submissions.page.title', 'ZATCA submissions')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('saudi_localization.submissions.searchPlaceholder', 'Invoice number')}
          searchAlign={direction === 'rtl' ? 'left' : 'right'}
          filters={[{
            id: 'status',
            label: t('saudi_localization.submissions.filters.status', 'Status'),
            type: 'select',
            options: ['pending', 'submitted', 'cleared', 'rejected'].map((status) => ({
              value: status,
              label: t(`saudi_localization.submissions.status.${status}`, STATUS_FALLBACKS[status]),
            })),
          }]}
          filterValues={values}
          onFiltersApply={(next) => { setValues(next); setPage(1) }}
          onFiltersClear={() => { setValues({}); setPage(1) }}
          entityId="saudi_localization:saudi_einvoice_submission"
          pagination={{
            page,
            pageSize: 50,
            total: data?.total ?? 0,
            totalPages: data?.totalPages ?? 0,
            totalIsCapped: data?.totalIsCapped === true,
            onPageChange: setPage,
          }}
          isLoading={query.isLoading}
        />
      </PageBody>
    </Page>
  )
}
