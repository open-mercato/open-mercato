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
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useDirection, useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useInitialFilters } from '../lib/useInitialFilters'
import { customerNameOf, formatFreightDate } from './freightOptions'
import {
  DELIVERY_NOTE_STATUS_FALLBACKS,
  DELIVERY_NOTE_STATUS_VALUES,
  EXTERNAL_WAYBILL_STATUS_FALLBACKS,
  EXTERNAL_WAYBILL_STATUS_VALUES,
  deliveryNoteSourceLabel,
  snapshotName,
  type DeliveryNoteActionMode,
  type FreightDeliveryNoteRow,
} from './deliveryNoteOptions'
import { DeliveryNoteActionDialog } from './DeliveryNoteActionDialog'

const RESOURCE = 'freight_operations/delivery-notes'
const ENTITY_ID = 'freight_operations:freight_delivery_note'
const CONTEXT_ID = 'freight_operations.delivery_notes.list'
const INITIAL_FILTER_KEYS = ['status', 'externalWaybillStatus', 'q']
const LABEL_MISSING = '—'

const detailHref = (id: string) => `/backend/freight/delivery-notes/${id}`

export default function DeliveryNotesTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [values, setValues] = React.useState<FilterValues>(useInitialFilters(INITIAL_FILTER_KEYS))
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])
  const [page, setPage] = React.useState(1)
  const [actionNote, setActionNote] = React.useState<FreightDeliveryNoteRow | null>(null)
  const [actionMode, setActionMode] = React.useState<DeliveryNoteActionMode | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const waybillFilter = typeof values.externalWaybillStatus === 'string' ? values.externalWaybillStatus : undefined
  const searchValue = typeof values.q === 'string' ? values.q : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'created_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    if (waybillFilter) out.externalWaybillStatus = waybillFilter
    if (searchValue && searchValue.trim().length) out.search = searchValue.trim()
    return out
  }, [page, searchValue, sorting, statusFilter, waybillFilter])

  const query = useQuery({
    queryKey: ['freight-delivery-notes-list', params, scopeVersion],
    queryFn: () => fetchCrudList<FreightDeliveryNoteRow>(RESOURCE, params),
  })

  const openAction = React.useCallback((note: FreightDeliveryNoteRow, mode: DeliveryNoteActionMode) => {
    setActionNote(note)
    setActionMode(mode)
  }, [])

  const removeDraft = React.useCallback(async (note: FreightDeliveryNoteRow) => {
    const confirmed = await confirm({
      title: t('freight_operations.delivery_notes.delete.confirm', 'Delete the draft delivery note {number}?', {
        number: note.note_number,
      }),
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(note.updatedAt ?? note.updated_at ?? null),
          () => apiCallOrThrow(`/api/${RESOURCE}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: note.id }),
          }, {
            errorMessage: t('freight_operations.delivery_notes.delete.error', 'Unable to delete the delivery note.'),
          }),
        ),
        mutationPayload: { operation: 'delivery_notes.delete', id: note.id, updatedAt: note.updatedAt ?? null },
        context: {
          formId: CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: note.id,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.delivery_notes.delete.success', 'Delivery note deleted.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('freight_operations.delivery_notes.delete.error', 'Unable to delete the delivery note.'),
        'error',
      )
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<FreightDeliveryNoteRow>[]>(() => [
    {
      accessorKey: 'note_number',
      header: t('freight_operations.delivery_notes.columns.number', 'Delivery note'),
      cell: ({ row }) => (
        <Link
          href={detailHref(row.original.id)}
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {row.original.note_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'source',
      header: t('freight_operations.delivery_notes.columns.source', 'Source'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">{deliveryNoteSourceLabel(row.original)}</span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'party',
      header: t('freight_operations.delivery_notes.columns.party', 'Customer / consignee'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">
            {row.original.consignee_name ||
              customerNameOf(row.original.customer_snapshot, LABEL_MISSING)}
          </span>
          {snapshotName(row.original.customer_snapshot, 'displayName') ? (
            <span className="truncate text-xs text-muted-foreground">
              {snapshotName(row.original.customer_snapshot, 'displayName')}
            </span>
          ) : null}
        </span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '20rem' },
    },
    {
      id: 'lane',
      header: t('freight_operations.delivery_notes.columns.lane', 'Lane'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">
            {[row.original.origin, row.original.destination].filter(Boolean).join(' → ') || LABEL_MISSING}
          </span>
          <span className="truncate text-xs text-muted-foreground">{row.original.cargo_description}</span>
        </span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '22rem' },
    },
    {
      accessorKey: 'status',
      header: t('freight_operations.delivery_notes.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as FreightDeliveryNoteRow['status']
        return (
          <Badge variant="secondary">
            {t(`freight_operations.delivery_notes.status.${value}`, DELIVERY_NOTE_STATUS_FALLBACKS[value])}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
    {
      id: 'waybill',
      header: t('freight_operations.delivery_notes.columns.waybill', 'Bayan Naql'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col gap-1">
          <span className="text-sm">{row.original.external_waybill_number || LABEL_MISSING}</span>
          <span className="text-xs text-muted-foreground">
            {t(
              `freight_operations.delivery_notes.waybillStatus.${row.original.external_waybill_status}`,
              EXTERNAL_WAYBILL_STATUS_FALLBACKS[row.original.external_waybill_status],
            )}
          </span>
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'issued_at',
      header: t('freight_operations.delivery_notes.columns.issuedAt', 'Issued'),
      cell: ({ row }) => (
        <span className="text-sm">{formatFreightDate(row.original.issued_at, locale)}</span>
      ),
      meta: { priority: 2 },
    },
  ], [locale, t])

  if (query.isError) {
    return (
      <div className="text-sm text-status-error-text">
        {t('freight_operations.delivery_notes.error.load', 'Unable to load delivery notes.')}
      </div>
    )
  }

  return (
    <>
      <DataTable
        title={t('freight_operations.delivery_notes.page.title', 'Delivery notes')}
        titleHeadingLevel={1}
        searchValue={searchValue}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t(
          'freight_operations.delivery_notes.search.placeholder',
          'Number, consignee, waybill, or cargo',
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('freight_operations.delivery_notes.actions.view', 'View'), href: detailHref(row.id) },
              ...(row.status === 'draft'
                ? [
                    { id: 'issue', label: t('freight_operations.delivery_notes.issue.submit', 'Issue'), onSelect: () => openAction(row, 'issue') },
                    { id: 'delete', label: t('freight_operations.delivery_notes.actions.delete', 'Delete'), onSelect: () => { void removeDraft(row) } },
                  ]
                : []),
              ...(row.status === 'issued'
                ? [{ id: 'deliver', label: t('freight_operations.delivery_notes.actions.recordDelivery', 'Record delivery'), onSelect: () => openAction(row, 'deliver') }]
                : []),
              ...((row.status === 'issued' || row.status === 'delivered') && row.external_waybill_status !== 'recorded'
                ? [{ id: 'waybill', label: t('freight_operations.delivery_notes.actions.recordWaybill', 'Record waybill'), onSelect: () => openAction(row, 'waybill') }]
                : []),
              ...(row.external_waybill_status === 'recorded'
                ? [{ id: 'waybill-cancel', label: t('freight_operations.delivery_notes.actions.cancelWaybill', 'Cancel waybill'), onSelect: () => openAction(row, 'waybill_cancel') }]
                : []),
              ...(row.status === 'draft' || row.status === 'issued'
                ? [{ id: 'cancel', label: t('freight_operations.delivery_notes.actions.cancel', 'Cancel'), onSelect: () => openAction(row, 'cancel') }]
                : []),
            ]}
          />
        )}
        columns={columns}
        data={query.data?.items ?? []}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('freight_operations.delivery_notes.filters.status', 'Status'),
            type: 'select',
            options: DELIVERY_NOTE_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.delivery_notes.status.${value}`, DELIVERY_NOTE_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'externalWaybillStatus',
            label: t('freight_operations.delivery_notes.filters.waybill', 'Bayan Naql'),
            type: 'select',
            options: EXTERNAL_WAYBILL_STATUS_VALUES.map((value) => ({
              value,
              label: t(
                `freight_operations.delivery_notes.waybillStatus.${value}`,
                EXTERNAL_WAYBILL_STATUS_FALLBACKS[value],
              ),
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
          total: query.data?.total ?? 0,
          totalPages: query.data?.totalPages ?? 0,
          totalIsCapped: query.data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={query.isLoading}
      />
      <DeliveryNoteActionDialog
        note={actionNote}
        mode={actionMode}
        onOpenChange={(open) => {
          if (!open) {
            setActionNote(null)
            setActionMode(null)
          }
        }}
        onCompleted={() => { void query.refetch() }}
      />
      {ConfirmDialogElement}
    </>
  )
}
