"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export const RESOURCE = 'financial/journal-entries'
export const CREATE_HREF = '/backend/financial/journal-entries/create'
export const editHref = (id: string) => `/backend/financial/journal-entries/${id}/edit`
export const ENTITY_ID = 'financial:gl_journal_entry'

const LIST_MUTATION_CONTEXT_ID = 'financial.journal_entries.list'

export type JournalEntryStatus = 'draft' | 'posted' | 'reversed'
// `opening` is listed but deliberately absent from ENTRY_TYPE_VALUES: opening
// balances are posted by their own screen, which builds the one balanced entry
// they are, so the form must not offer it as a free choice — the list still has
// to name it, because those entries appear in it.
export type JournalEntryType = 'standard' | 'adjusting' | 'closing' | 'reversing' | 'opening'

export const ENTRY_STATUS_VALUES: JournalEntryStatus[] = ['draft', 'posted', 'reversed']
export const ENTRY_TYPE_VALUES: JournalEntryType[] = ['standard', 'adjusting', 'closing', 'reversing']

export const ENTRY_STATUS_FALLBACKS: Record<JournalEntryStatus, string> = {
  draft: 'Draft',
  posted: 'Posted',
  reversed: 'Reversed',
}

export const ENTRY_TYPE_FALLBACKS: Record<JournalEntryType, string> = {
  standard: 'Standard',
  adjusting: 'Adjusting',
  closing: 'Closing',
  reversing: 'Reversing',
  opening: 'Opening balances',
}

export type JournalEntryRow = {
  id: string
  entry_number: string
  entry_date: string
  posting_date: string
  period_id: string
  entry_type: JournalEntryType
  description: string
  reference?: string | null
  currency_code: string
  status: JournalEntryStatus
  updated_at?: string | null
  updatedAt?: string | null
}

type EntryMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

export default function FinancialEntriesTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<EntryMutationContext>({
    contextId: LIST_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [values, setValues] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entry_date', desc: true }])
  const [page, setPage] = React.useState(1)

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const entryTypeFilter = typeof values.entryType === 'string' ? values.entryType : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'entry_date',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (statusFilter) out.status = statusFilter
    if (entryTypeFilter) out.entryType = entryTypeFilter
    return out
  }, [entryTypeFilter, page, search, sorting, statusFilter])

  const query = useQuery({
    queryKey: ['financial-entries', params, scopeVersion],
    queryFn: () => fetchCrudList<JournalEntryRow>(RESOURCE, params),
  })

  const data = query.data

  const runEntryAction = React.useCallback(async (row: JournalEntryRow, action: 'post' | 'reverse') => {
    const confirmed = await confirm({
      title: action === 'post'
        ? t('financial.entries.post.confirm', 'Post this entry into the ledger?')
        : t('financial.entries.reverse.confirm', 'Create the reversing entry for this one?'),
    })
    if (!confirmed) return
    const successMessage = action === 'post'
      ? t('financial.entries.post.success', 'Entry posted.')
      : t('financial.entries.reverse.success', 'Entry reversed.')
    const errorFallback = action === 'post'
      ? t('financial.entries.post.error', 'Unable to post the entry.')
      : t('financial.entries.reverse.error', 'Unable to reverse the entry.')
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow(`/api/financial/journal-entries/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        }, { errorMessage: errorFallback }),
        mutationPayload: { operation: `journal_entries.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: {
          formId: LIST_MUTATION_CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(successMessage, 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : errorFallback, 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<JournalEntryRow>[]>(() => [
    {
      accessorKey: 'entry_number',
      header: t('financial.entries.columns.entryNumber', 'Entry'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'entry_date',
      header: t('financial.entries.columns.entryDate', 'Entry date'),
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'posting_date',
      header: t('financial.entries.columns.postingDate', 'Posting date'),
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'entry_type',
      header: t('financial.entries.columns.entryType', 'Type'),
      cell: ({ getValue }) => {
        const value = getValue() as JournalEntryType
        return (
          <span className="text-sm">
            {t(`financial.entries.type.${value}`, ENTRY_TYPE_FALLBACKS[value] ?? value)}
          </span>
        )
      },
      meta: { priority: 3 },
    },
    {
      accessorKey: 'description',
      header: t('financial.entries.columns.description', 'Description'),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('financial.entries.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as JournalEntryStatus
        return (
          <Badge variant="secondary">
            {t(`financial.entries.status.${value}`, ENTRY_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('financial.entries.error.load', 'Failed to load journal entries.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('financial.entries.page.title', 'Journal entries')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('financial.entries.actions.create', 'New entry')}</Link>
          </Button>
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              ...(row.status === 'draft'
                ? [{ id: 'edit', label: t('financial.entries.actions.edit', 'Edit'), href: editHref(row.id) }]
                : []),
              ...(row.status === 'draft'
                ? [{
                    id: 'post',
                    label: t('financial.entries.actions.post', 'Post'),
                    onSelect: () => { void runEntryAction(row, 'post') },
                  }]
                : []),
              ...(row.status === 'posted'
                ? [{
                    id: 'reverse',
                    label: t('financial.entries.actions.reverse', 'Reverse'),
                    onSelect: () => { void runEntryAction(row, 'reverse') },
                  }]
                : []),
            ]}
          />
        )}
        columns={columns}
        data={data?.items ?? []}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('financial.entries.searchPlaceholder', 'Number, reference or description')}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('financial.entries.filters.status', 'Status'),
            type: 'select',
            options: ENTRY_STATUS_VALUES.map((value) => ({
              value,
              label: t(`financial.entries.status.${value}`, ENTRY_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'entryType',
            label: t('financial.entries.filters.entryType', 'Type'),
            type: 'select',
            options: ENTRY_TYPE_VALUES.map((value) => ({
              value,
              label: t(`financial.entries.type.${value}`, ENTRY_TYPE_FALLBACKS[value]),
            })),
          },
        ]}
        filterValues={values}
        onFiltersApply={(next: FilterValues) => {
          setValues(next)
          setPage(1)
        }}
        onFiltersClear={() => {
          setValues({})
          setPage(1)
        }}
        entityId={ENTITY_ID}
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
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
      {ConfirmDialogElement}
    </>
  )
}

