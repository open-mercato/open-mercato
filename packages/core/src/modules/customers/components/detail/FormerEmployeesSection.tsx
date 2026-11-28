"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { PersonNameCell } from './PersonCard'
import type { Translator } from './types'

type FormerEmployee = { id: string; displayName: string; employmentEndedOn: string }
type FormerEmployeesPage = { items: FormerEmployee[]; page: number; total: number; totalPages: number }
type LoadState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; data: FormerEmployeesPage }
const pageSize = 20

export function FormerEmployeesSection({ companyId, refreshKey, translate }: {
  companyId: string
  refreshKey: number
  translate: Translator
}) {
  const locale = useLocale()
  const [page, setPage] = React.useState(1)
  const [attempt, setAttempt] = React.useState(0)
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const title = translate('customers.companies.detail.employment.formerEmployees', 'Former employees')
  const loadError = translate('customers.companies.detail.employment.loadError', 'Failed to load former employees.')

  React.useEffect(() => {
    const request = new AbortController()
    const query = new URLSearchParams({ employmentStatus: 'ended', sort: 'recent', page: String(page), pageSize: String(pageSize) })
    setState({ status: 'loading' })
    void readApiResultOrThrow<FormerEmployeesPage>(
      `/api/customers/companies/${encodeURIComponent(companyId)}/people?${query.toString()}`,
      { signal: request.signal },
      { errorMessage: loadError },
    ).then((data) => {
      if (!request.signal.aborted) {
        const items = (data.items ?? []).filter((item) => typeof item.employmentEndedOn === 'string')
        setState({ status: 'loaded', data: { ...data, items } })
      }
    }).catch(() => {
      if (!request.signal.aborted) setState({ status: 'failed' })
    })
    return () => request.abort()
  }, [attempt, companyId, loadError, page, refreshKey])

  const formatDate = React.useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }), [locale])
  const columns = React.useMemo<ColumnDef<FormerEmployee>[]>(() => [
    {
      id: 'displayName',
      header: translate('customers.people.list.columns.name', 'Name'),
      cell: ({ row }) => <PersonNameCell person={row.original} />,
    },
    {
      id: 'employmentEndedOn',
      header: translate('customers.companies.detail.employment.departureDate', 'Departure date'),
      cell: ({ row }) => {
        const dateOnly = row.original.employmentEndedOn
        const date = new Date(`${dateOnly}T00:00:00Z`)
        return Number.isFinite(date.getTime()) ? <time dateTime={dateOnly}>{formatDate.format(date)}</time> : null
      },
    },
  ], [formatDate, translate])

  if (state.status === 'loaded' && !state.data.items.length) return null
  if (state.status === 'loading') {
    return <LoadingMessage className="mt-6" label={translate('customers.companies.detail.employment.loading', 'Loading former employees…')} />
  }

  return (
    <section aria-label={title} className="mt-6 space-y-3">
      <SectionHeader title={title} />
      {state.status === 'failed' ? (
        <ErrorMessage label={loadError} action={(
          <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {translate('customers.companies.detail.employment.retry', 'Retry')}
          </Button>
        )} />
      ) : (
        <DataTable
          embedded
          disableRowClick
          showQueryTime={false}
          columns={columns}
          data={state.data.items}
          pagination={state.data.totalPages > 1 ? {
            page: state.data.page,
            pageSize,
            total: state.data.total,
            totalPages: state.data.totalPages,
            onPageChange: setPage,
          } : undefined}
        />
      )}
    </section>
  )
}
