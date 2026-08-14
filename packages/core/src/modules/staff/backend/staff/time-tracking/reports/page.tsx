"use client"

/**
 * The reports index. The mockups never draw it — they start at "New report" —
 * but a closed report is a document somebody has to be able to find again
 * months later, and screen 13's already-reported panel links straight to the
 * reports that froze an hour. Without a list those links land nowhere.
 *
 * It also absorbs the projects list's "Report from selected" hand-off: that
 * screen pushes `?customerId=…&projectIds=…` here, and this page forwards the
 * selection to the configuration screen rather than making the user re-pick it.
 */

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileText, Lock, Plus } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readCustomerName } from '../../../../lib/timesheets-reports/reportSheetData'
import { readNumber } from '../../../../lib/timesheets-reports/reportConfigData'
import { formatReportMinutes } from '../../../../lib/timesheets-reports/reportTotals'

const logger = createLogger('staff').child({ component: 'time-tracking/reports/list' })

const REPORTS_HREF = '/backend/staff/time-tracking/reports'
const REPORTS_API = '/api/staff/timesheets/reports'
const MANAGE_FEATURE = 'staff.timesheets.reports.manage'
const RATES_FEATURE = 'staff.timesheets.rates.view'
const PAGE_SIZE = 25

type ReportRow = {
  id: string
  reference: string
  title: string
  customerName: string
  status: 'draft' | 'closed'
  periodFrom: string
  periodTo: string
  currencyCode: string | null
  totalAmount: number | null
  totalBillableMinutes: number | null
}

function toRow(raw: Record<string, unknown>): ReportRow | null {
  const id = typeof raw.id === 'string' ? raw.id : null
  if (!id) return null
  return {
    id,
    reference: typeof raw.reference === 'string' ? raw.reference : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    customerName: readCustomerName(raw.customer_snapshot ?? raw.customerSnapshot) ?? '',
    status: raw.status === 'closed' ? 'closed' : 'draft',
    periodFrom: typeof raw.period_from === 'string' ? raw.period_from.slice(0, 10) : '',
    periodTo: typeof raw.period_to === 'string' ? raw.period_to.slice(0, 10) : '',
    currencyCode: typeof raw.currency_code === 'string' ? raw.currency_code : null,
    totalAmount: readNumber(raw.total_amount),
    totalBillableMinutes: readNumber(raw.total_billable_minutes),
  }
}

export default function TimeTrackingReportsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const canManage = hasFeature(payload?.grantedFeatures, MANAGE_FEATURE)
  const canSeeMoney = hasFeature(payload?.grantedFeatures, RATES_FEATURE)

  const [rows, setRows] = React.useState<ReportRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)

  const handoffCustomerId = searchParams.get('customerId')
  const handoffProjectIds = searchParams.get('projectIds')

  React.useEffect(() => {
    if (!handoffCustomerId && !handoffProjectIds) return
    const params = new URLSearchParams()
    if (handoffCustomerId) params.set('customerId', handoffCustomerId)
    if (handoffProjectIds) params.set('projectIds', handoffProjectIds)
    router.replace(`${REPORTS_HREF}/create?${params.toString()}`)
  }, [handoffCustomerId, handoffProjectIds, router])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    void readApiResultOrThrow<Record<string, unknown>>(`${REPORTS_API}?${params.toString()}`, undefined, {
      allowNullResult: true,
    })
      .then((result) => {
        if (cancelled) return
        const items = Array.isArray((result as { items?: unknown })?.items)
          ? ((result as { items: unknown[] }).items as Array<Record<string, unknown>>)
          : []
        setRows(items.map(toRow).filter((row): row is ReportRow => row !== null))
        setTotal(readNumber((result as { total?: unknown })?.total) ?? 0)
      })
      .catch((err) => {
        if (cancelled) return
        logger.error('staff.time_tracking.reports list failed', { err })
        setRows([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, scopeVersion])

  const columns = React.useMemo<ColumnDef<ReportRow>[]>(() => {
    const base: ColumnDef<ReportRow>[] = [
      {
        id: 'reference',
        header: t('staff.time_tracking.reports.list.reference', 'Number'),
        accessorKey: 'reference',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span>,
      },
      {
        id: 'title',
        header: t('staff.time_tracking.reports.list.title', 'Report'),
        accessorKey: 'title',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.title}</span>
            {row.original.customerName ? (
              <span className="text-xs text-muted-foreground">{row.original.customerName}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'period',
        header: t('staff.time_tracking.reports.list.period', 'Period'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.periodFrom} – {row.original.periodTo}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('staff.time_tracking.reports.list.status', 'Status'),
        cell: ({ row }) =>
          row.original.status === 'closed' ? (
            <Badge variant="success">
              <Lock aria-hidden="true" className="size-3" />
              {t('staff.time_tracking.reports.status.closed', 'Closed')}
            </Badge>
          ) : (
            <Badge variant="warning">{t('staff.time_tracking.reports.status.draft', 'Draft')}</Badge>
          ),
      },
      {
        id: 'hours',
        header: t('staff.time_tracking.reports.list.hours', 'Billable'),
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {row.original.totalBillableMinutes === null
              ? '—'
              : formatReportMinutes(row.original.totalBillableMinutes)}
          </span>
        ),
      },
    ]

    if (canSeeMoney) {
      base.push({
        id: 'amount',
        header: t('staff.time_tracking.reports.list.amount', 'Total'),
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {row.original.totalAmount === null
              ? '—'
              : (formatCurrency(row.original.totalAmount, row.original.currencyCode ?? undefined) ?? '—')}
          </span>
        ),
      })
    }

    return base
  }, [canSeeMoney, t])

  return (
    <Page>
      <PageBody>
        <DataTable<ReportRow>
          title={t('staff.time_tracking.nav.reports', 'Reports')}
          columns={columns}
          data={rows}
          isLoading={loading}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            onPageChange: setPage,
          }}
          onRowClick={(row) => router.push(`${REPORTS_HREF}/${row.id}`)}
          emptyState={
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t(
                'staff.time_tracking.reports.list.empty',
                'No reports yet. Generate one for a customer to see what is billable.',
              )}
            </div>
          }
          actions={
            canManage ? (
              <Button onClick={() => router.push(`${REPORTS_HREF}/create`)}>
                <Plus aria-hidden="true" />
                {t('staff.time_tracking.reports.list.create', 'New report')}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <FileText aria-hidden="true" className="size-4" />
                {t('staff.time_tracking.reports.list.readOnly', 'You can view reports but not create them.')}
              </span>
            )
          }
        />
      </PageBody>
    </Page>
  )
}
