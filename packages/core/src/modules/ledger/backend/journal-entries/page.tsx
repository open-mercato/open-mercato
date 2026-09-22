'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { loadFiscalPeriodOptions, loadLedgerAccountOptions } from '../lib/optionLoaders'

// Read-only list — no create/edit/delete anywhere on this page. Entries are
// only ever produced by `postJournalEntry` / `reverseJournalEntry` (see
// api/journal-entries/route.ts's own header comment).
type JournalEntryRow = {
  id: string
  sequenceNumber: number
  postedAt: string
  operationDate: string
  documentType: string | null
  documentNumber: string | null
  description: string
  type: 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL'
  currencyId: string
  referenceType: string | null
  referenceId: string | null
}

type ResponsePayload = {
  items: JournalEntryRow[]
  total: number
  page: number
  totalPages: number
}

const TYPE_BADGE_VARIANT: Record<JournalEntryRow['type'], 'default' | 'secondary' | 'destructive'> = {
  NORMAL: 'default',
  OPENING: 'secondary',
  CLOSING: 'secondary',
  REVERSAL: 'destructive',
}

export default function JournalEntriesPage() {
  const t = useT()
  const [rows, setRows] = React.useState<JournalEntryRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (filters.accountId) params.set('accountId', String(filters.accountId))
        if (filters.periodId) params.set('periodId', String(filters.periodId))
        if (filters.type) params.set('type', String(filters.type))

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/ledger/journal-entries?${params.toString()}`, undefined, {
          fallback,
        })
        if (!call.ok) {
          flash(t('ledger.journal_entries.list.error.load', 'Failed to load journal entries'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch {
        if (!cancelled) flash(t('ledger.journal_entries.list.error.load', 'Failed to load journal entries'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, filters, scopeVersion, t])

  const columns = React.useMemo<ColumnDef<JournalEntryRow>[]>(
    () => [
      {
        accessorKey: 'sequenceNumber',
        header: t('ledger.journal_entries.list.columns.sequenceNumber', '#'),
        cell: ({ row }) => <span className="font-mono">{row.original.sequenceNumber}</span>,
      },
      {
        accessorKey: 'operationDate',
        header: t('ledger.journal_entries.list.columns.operationDate', 'Operation date'),
      },
      {
        accessorKey: 'type',
        header: t('ledger.journal_entries.list.columns.type', 'Type'),
        cell: ({ row }) => <Badge variant={TYPE_BADGE_VARIANT[row.original.type]}>{row.original.type}</Badge>,
      },
      {
        accessorKey: 'description',
        header: t('ledger.journal_entries.list.columns.description', 'Description'),
      },
      {
        accessorKey: 'documentNumber',
        header: t('ledger.journal_entries.list.columns.documentNumber', 'Document no.'),
        enableSorting: false,
        cell: ({ row }) => row.original.documentNumber || '—',
      },
      {
        accessorKey: 'referenceType',
        header: t('ledger.journal_entries.list.columns.reference', 'Reference'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.referenceType
            ? `${row.original.referenceType}${row.original.referenceId ? ` (${row.original.referenceId})` : ''}`
            : '—',
      },
      {
        accessorKey: 'postedAt',
        header: t('ledger.journal_entries.list.columns.postedAt', 'Posted at'),
        cell: ({ row }) => new Date(row.original.postedAt).toLocaleString(),
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'accountId',
        label: t('ledger.journal_entries.list.filters.account', 'Account'),
        type: 'combobox',
        loadOptions: (query?: string) => loadLedgerAccountOptions(query),
      },
      {
        id: 'periodId',
        label: t('ledger.journal_entries.list.filters.period', 'Fiscal period'),
        type: 'combobox',
        loadOptions: (query?: string) => loadFiscalPeriodOptions(query),
      },
      {
        id: 'type',
        label: t('ledger.journal_entries.list.filters.type', 'Type'),
        type: 'select',
        options: [
          { label: t('ledger.journal_entries.list.filters.all', 'All'), value: '' },
          { label: 'NORMAL', value: 'NORMAL' },
          { label: 'OPENING', value: 'OPENING' },
          { label: 'CLOSING', value: 'CLOSING' },
          { label: 'REVERSAL', value: 'REVERSAL' },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('ledger.journal_entries.list.title', 'Journal Entries')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => {
            setFilters(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          emptyState={<ListEmptyState entityName={t('ledger.journal_entries.list.title', 'Journal Entries')} />}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
