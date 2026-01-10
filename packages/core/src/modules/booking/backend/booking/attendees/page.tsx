"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FilterDef, FilterOption, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 50

type AttendeeRow = {
  id: string
  eventId: string | null
  eventTitle: string | null
  eventStartsAt: string | null
  eventEndsAt: string | null
  customerId: string | null
  customerName: string | null
  customerKind: string | null
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  attendeeType: string | null
  createdAt: string | null
}

type AttendeesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type EventOptionsResponse = {
  items?: Array<{ id?: string; title?: string; startsAt?: string; endsAt?: string }>
}

export default function BookingAttendeesPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<AttendeeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'lastName', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [eventFilterOptions, setEventFilterOptions] = React.useState<FilterOption[]>([])

  const labels = React.useMemo(() => ({
    title: t('booking.attendees.page.title', 'Attendees'),
    description: t('booking.attendees.page.description', 'Track who is booked for each event.'),
    table: {
      name: t('booking.attendees.table.name', 'Name'),
      event: t('booking.attendees.table.event', 'Booking'),
      customer: t('booking.attendees.table.customer', 'Customer'),
      email: t('booking.attendees.table.email', 'Email'),
      phone: t('booking.attendees.table.phone', 'Phone'),
      type: t('booking.attendees.table.type', 'Type'),
      createdAt: t('booking.attendees.table.createdAt', 'Created'),
      empty: t('booking.attendees.table.empty', 'No attendees yet.'),
      search: t('booking.attendees.table.search', 'Search attendees...'),
    },
    filters: {
      event: t('booking.attendees.filters.event', 'Booking'),
    },
    actions: {
      add: t('booking.attendees.actions.add', 'Add attendee'),
      edit: t('booking.attendees.actions.edit', 'Edit'),
      delete: t('booking.attendees.actions.delete', 'Delete'),
      deleteConfirm: t('booking.attendees.actions.deleteConfirm', 'Delete attendee "{{name}}"?'),
      refresh: t('booking.attendees.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: t('booking.attendees.messages.deleted', 'Attendee deleted.'),
    },
    errors: {
      load: t('booking.attendees.errors.load', 'Failed to load attendees.'),
      delete: t('booking.attendees.errors.delete', 'Failed to delete attendee.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<AttendeeRow>[]>(() => [
    {
      accessorKey: 'lastName',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{`${row.original.firstName} ${row.original.lastName}`.trim()}</span>
          {row.original.attendeeType ? (
            <span className="text-xs text-muted-foreground">{row.original.attendeeType}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'eventTitle',
      header: labels.table.event,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const title = row.original.eventTitle ?? row.original.eventId
        if (!title) return <span className="text-xs text-muted-foreground">-</span>
        const range = formatEventRange(row.original.eventStartsAt, row.original.eventEndsAt)
        return (
          <div className="flex flex-col">
            <span className="text-sm">{title}</span>
            {range ? <span className="text-xs text-muted-foreground">{range}</span> : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'customerName',
      header: labels.table.customer,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.customerName
        ? (
          <div className="flex flex-col">
            <span className="text-sm">{row.original.customerName}</span>
            {row.original.customerKind ? (
              <span className="text-xs text-muted-foreground">{row.original.customerKind}</span>
            ) : null}
          </div>
        )
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'email',
      header: labels.table.email,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.email
        ? <span className="text-sm">{row.original.email}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'phone',
      header: labels.table.phone,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.phone
        ? <span className="text-sm">{row.original.phone}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'createdAt',
      header: labels.table.createdAt,
      meta: { priority: 6 },
      cell: ({ row }) => row.original.createdAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.table.createdAt, labels.table.customer, labels.table.email, labels.table.event, labels.table.name, labels.table.phone])

  const loadEventOptions = React.useCallback(async (): Promise<FilterOption[]> => {
    const params = new URLSearchParams({ pageSize: '100' })
    const call = await apiCall<EventOptionsResponse>(`/api/booking/event-options?${params.toString()}`)
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const options = items
      .map((event) => {
        const id = typeof event.id === 'string' ? event.id : null
        const title = typeof event.title === 'string' ? event.title : null
        if (!id || !title) return null
        const range = formatEventRange(event.startsAt ?? null, event.endsAt ?? null)
        return { value: id, label: range ? `${title} · ${range}` : title }
      })
      .filter((option): option is FilterOption => option !== null)
    setEventFilterOptions(options)
    return options
  }, [])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'eventId',
      label: labels.filters.event,
      type: 'select',
      options: eventFilterOptions,
      loadOptions: loadEventOptions,
    },
  ], [eventFilterOptions, labels.filters.event, loadEventOptions])

  const loadAttendees = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (search.trim()) params.set('search', search.trim())
      if (filterValues.eventId) params.set('eventId', String(filterValues.eventId))
      const payload = await readApiResultOrThrow<AttendeesResponse>(
        `/api/booking/event-attendees?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiAttendee))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('booking.event-attendees.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [filterValues.eventId, labels.errors.load, page, search, sorting])

  React.useEffect(() => {
    void loadAttendees()
  }, [loadAttendees, scopeVersion])

  const handleDelete = React.useCallback(async (row: AttendeeRow) => {
    const fullName = `${row.firstName} ${row.lastName}`.trim()
    const confirmLabel = labels.actions.deleteConfirm.replace('{{name}}', fullName || row.id)
    if (!window.confirm(confirmLabel)) return
    try {
      await deleteCrud('booking/event-attendees', row.id, {
        errorMessage: labels.errors.delete,
      })
      flash(labels.messages.deleted, 'success')
      await loadAttendees()
    } catch (error) {
      console.error('booking.event-attendees.delete', error)
      const message = error instanceof Error ? error.message : labels.errors.delete
      flash(message, 'error')
    }
  }, [labels.actions.deleteConfirm, labels.errors.delete, labels.messages.deleted, loadAttendees])

  return (
    <Page>
      <PageBody>
        <DataTable<AttendeeRow>
          title={labels.title}
          actions={(
            <Button size="sm" asChild>
              <Link href="/backend/booking/attendees/create">{labels.actions.add}</Link>
            </Button>
          )}
          data={rows}
          columns={columns}
          searchValue={search}
          searchPlaceholder={labels.table.search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          isLoading={isLoading}
          emptyState={<div className="p-6 text-sm text-muted-foreground">{labels.table.empty}</div>}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          rowActions={(row) => (
            <RowActions
              actions={[
                {
                  label: labels.actions.edit,
                  onClick: () => router.push(`/backend/booking/attendees/${encodeURIComponent(row.id)}`),
                },
                {
                  label: labels.actions.delete,
                  onClick: () => { void handleDelete(row) },
                  destructive: true,
                },
              ]}
            />
          )}
          perspective={{ tableId: 'booking.attendees.list' }}
        />
      </PageBody>
    </Page>
  )
}

function mapApiAttendee(item: Record<string, unknown>): AttendeeRow {
  const eventId = typeof item.eventId === 'string'
    ? item.eventId
    : typeof item.event_id === 'string'
      ? item.event_id
      : null
  const customerId = typeof item.customerId === 'string'
    ? item.customerId
    : typeof item.customer_id === 'string'
      ? item.customer_id
      : null
  return {
    id: String(item.id ?? ''),
    eventId,
    eventTitle: typeof item.eventTitle === 'string' ? item.eventTitle : null,
    eventStartsAt: typeof item.eventStartsAt === 'string' ? item.eventStartsAt : null,
    eventEndsAt: typeof item.eventEndsAt === 'string' ? item.eventEndsAt : null,
    customerId,
    customerName: typeof item.customerDisplayName === 'string' ? item.customerDisplayName : null,
    customerKind: typeof item.customerKind === 'string' ? item.customerKind : null,
    firstName: typeof item.firstName === 'string'
      ? item.firstName
      : typeof item.first_name === 'string'
        ? item.first_name
        : '',
    lastName: typeof item.lastName === 'string'
      ? item.lastName
      : typeof item.last_name === 'string'
        ? item.last_name
        : '',
    email: typeof item.email === 'string' ? item.email : null,
    phone: typeof item.phone === 'string' ? item.phone : null,
    attendeeType: typeof item.attendeeType === 'string'
      ? item.attendeeType
      : typeof item.attendee_type === 'string'
        ? item.attendee_type
        : null,
    createdAt: typeof item.createdAt === 'string'
      ? item.createdAt
      : typeof item.created_at === 'string'
        ? item.created_at
        : null,
  }
}

function formatEventRange(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `${formatter.format(startDate)} → ${formatter.format(endDate)}`
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
