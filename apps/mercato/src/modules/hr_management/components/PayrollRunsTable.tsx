'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'

const RESOURCE = 'hr_management/payroll-runs'
const CREATE_HREF = '/backend/hr/payroll/create'
const detailHref = (id: string) => `/backend/hr/payroll/${id}`

export type PayrollRunRow = {
  id: string
  period_start?: string | null
  period_end?: string | null
  payment_date?: string | null
  status: string
  currency_code: string
  gross_total?: string | null
  deduction_total?: string | null
  net_total?: string | null
  employee_count?: number | null
}

const STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  calculated: 'Calculated',
  submitted: 'Submitted',
  approved: 'Approved',
  paid: 'Paid',
  closed: 'Closed',
}

export default function PayrollRunsTable() {
  const t = useT()
  const direction = useDirection()
  const [page, setPage] = React.useState(1)
  const query = useQuery({
    queryKey: ['hr-payroll-runs', page],
    queryFn: () => fetchCrudList<PayrollRunRow>(RESOURCE, {
      page,
      pageSize: 50,
      sortField: 'periodStart',
      sortDir: 'desc',
    }),
  })
  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<PayrollRunRow>[]>(() => [
    {
      id: 'period',
      header: t('hr_management.payroll.columns.period', 'Period'),
      cell: ({ row }) => (
        <Link className="text-sm underline" href={detailHref(row.original.id)}>
          {(row.original.period_start ?? '').slice(0, 10)} — {(row.original.period_end ?? '').slice(0, 10)}
        </Link>
      ),
    },
    { accessorKey: 'employee_count', header: t('hr_management.payroll.columns.employees', 'Employees'), cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? 0)}</span> },
    { accessorKey: 'gross_total', header: t('hr_management.payroll.columns.gross', 'Gross'), cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '0')}</span> },
    { accessorKey: 'deduction_total', header: t('hr_management.payroll.columns.deductions', 'Deductions'), cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '0')}</span> },
    { accessorKey: 'net_total', header: t('hr_management.payroll.columns.net', 'Net'), cell: ({ getValue }) => <span className="text-sm font-medium">{String(getValue() ?? '0')}</span> },
    { accessorKey: 'currency_code', header: t('hr_management.payroll.columns.currency', 'Currency'), cell: ({ getValue }) => <span className="text-xs">{String(getValue() ?? '')}</span> },
    {
      accessorKey: 'status',
      header: t('hr_management.payroll.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const status = String(getValue() ?? 'draft')
        return <Badge variant={status === 'closed' ? 'success' : status === 'draft' ? 'outline' : 'default'}>{t(`hr_management.payroll.status.${status}`, STATUS_FALLBACKS[status] ?? status)}</Badge>
      },
    },
  ], [t])

  if (query.isError) return <p className="text-sm text-destructive">{t('hr_management.payroll.error.load', 'Could not load payroll runs.')}</p>

  return (
    <DataTable
      title={t('hr_management.payroll.page.title', 'Payroll')}
      titleHeadingLevel={1}
      actions={<Button asChild><Link href={CREATE_HREF}>{t('hr_management.payroll.actions.create', 'New payroll run')}</Link></Button>}
      columns={columns}
      data={rows}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      entityId="hr_management:hr_payroll_run"
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
  )
}
