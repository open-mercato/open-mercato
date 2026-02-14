"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { resolveMessageListItemComponent } from './typeUiRegistry'

type MessageFolder = 'inbox' | 'sent' | 'drafts' | 'archived' | 'all'

type MessageListItem = {
  id: string
  type: string
  subject: string
  bodyPreview: string
  senderUserId: string
  senderName?: string | null
  senderEmail?: string | null
  priority: string
  status: string
  hasObjects: boolean
  objectCount: number
  hasAttachments: boolean
  attachmentCount: number
  hasActions: boolean
  actionTaken?: string | null
  sentAt?: string | null
  readAt?: string | null
  threadId?: string | null
}

type MessageListResponse = {
  items?: MessageListItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

type MessageTypeItem = {
  type: string
  module: string
  labelKey: string
  ui?: {
    listItemComponent?: string | null
  } | null
}

type UserListItem = {
  id: string
  email?: string | null
  name?: string | null
}

function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? toErrorMessage(record.details)
      ?? null
    )
  }
  return null
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function statusToLabel(status: string, t: ReturnType<typeof useT>): string {
  switch (status) {
    case 'unread':
      return t('messages.status.unread', 'Unread')
    case 'read':
      return t('messages.status.read', 'Read')
    case 'archived':
      return t('messages.status.archived', 'Archived')
    case 'draft':
      return t('messages.status.draft', 'Draft')
    default:
      return status
  }
}

export function MessagesInboxPageClient() {
  const router = useRouter()
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [folder, setFolder] = React.useState<MessageFolder>('inbox')
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const pageSize = 20

  const listQuery = useQuery({
    queryKey: [
      'messages',
      'list',
      folder,
      search,
      page,
      pageSize,
      JSON.stringify(filterValues),
      scopeVersion,
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('folder', folder)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))

      if (search.trim()) {
        params.set('search', search.trim())
      }

      const status = typeof filterValues.status === 'string' ? filterValues.status.trim() : ''
      const type = typeof filterValues.type === 'string' ? filterValues.type.trim() : ''
      const hasObjects = typeof filterValues.hasObjects === 'string' ? filterValues.hasObjects.trim() : ''
      const hasAttachments = typeof filterValues.hasAttachments === 'string' ? filterValues.hasAttachments.trim() : ''
      const hasActions = typeof filterValues.hasActions === 'string' ? filterValues.hasActions.trim() : ''
      const senderId = typeof filterValues.senderId === 'string' ? filterValues.senderId.trim() : ''
      const since = typeof filterValues.since === 'string' ? filterValues.since.trim() : ''

      if (status) params.set('status', status)
      if (type) params.set('type', type)
      if (hasObjects) params.set('hasObjects', hasObjects)
      if (hasAttachments) params.set('hasAttachments', hasAttachments)
      if (hasActions) params.set('hasActions', hasActions)
      if (senderId) params.set('senderId', senderId)
      if (since) params.set('since', since)

      const call = await apiCall<MessageListResponse>(`/api/messages?${params.toString()}`)
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadListFailed', 'Failed to load messages.'),
        )
      }

      return {
        items: Array.isArray(call.result?.items) ? call.result?.items ?? [] : [],
        total: Number(call.result?.total ?? 0),
        page: Number(call.result?.page ?? page),
        pageSize: Number(call.result?.pageSize ?? pageSize),
        totalPages: Number(call.result?.totalPages ?? 1),
      }
    },
  })

  const messageTypesQuery = useQuery({
    queryKey: ['messages', 'types', scopeVersion],
    queryFn: async () => {
      const call = await apiCall<{ items?: MessageTypeItem[] }>('/api/messages/types')
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadTypesFailed', 'Failed to load message types.'),
        )
      }
      return Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    },
  })

  React.useEffect(() => {
    if (!listQuery.error) return
    flash(
      listQuery.error instanceof Error
        ? listQuery.error.message
        : t('messages.errors.loadListFailed', 'Failed to load messages.'),
      'error',
    )
  }, [listQuery.error, t])

  React.useEffect(() => {
    if (!messageTypesQuery.error) return
    flash(
      messageTypesQuery.error instanceof Error
        ? messageTypesQuery.error.message
        : t('messages.errors.loadTypesFailed', 'Failed to load message types.'),
      'error',
    )
  }, [messageTypesQuery.error, t])

  const messageTypeLabelMap = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const item of messageTypesQuery.data ?? []) {
      map[item.type] = t(item.labelKey, item.type)
    }
    return map
  }, [messageTypesQuery.data, t])

  const loadSenderOptions = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', '20')
    if (query && query.trim().length > 0) {
      params.set('search', query.trim())
    }

    const call = await apiCall<{ items?: UserListItem[] }>(`/api/auth/users?${params.toString()}`)
    if (!call.ok) return []

    const items = Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    return items.flatMap((item) => {
      if (!item || typeof item.id !== 'string' || item.id.trim().length === 0) return []
      const name = typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : null
      const email = typeof item.email === 'string' && item.email.trim().length > 0 ? item.email.trim() : null
      const label = name ?? email ?? item.id
      return [{
        value: item.id,
        label,
        description: email && email !== label ? email : null,
      }]
    })
  }, [])

  const listItemComponentKeyByType = React.useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const item of messageTypesQuery.data ?? []) {
      map[item.type] = item.ui?.listItemComponent ?? null
    }
    return map
  }, [messageTypesQuery.data])

  const filters = React.useMemo<FilterDef[]>(() => {
    const typeOptions = (messageTypesQuery.data ?? []).map((item) => ({
      value: item.type,
      label: t(item.labelKey, item.type),
    }))

    return [
      {
        id: 'status',
        label: t('messages.filters.status', 'Status'),
        type: 'select',
        options: [
          { value: '', label: t('messages.filters.all', 'All') },
          { value: 'unread', label: t('messages.status.unread', 'Unread') },
          { value: 'read', label: t('messages.status.read', 'Read') },
          { value: 'archived', label: t('messages.status.archived', 'Archived') },
        ],
      },
      {
        id: 'type',
        label: t('messages.filters.type', 'Type'),
        type: 'select',
        options: [{ value: '', label: t('messages.filters.all', 'All') }, ...typeOptions],
      },
      {
        id: 'hasObjects',
        label: t('messages.filters.hasObjects', 'Objects'),
        type: 'select',
        options: [
          { value: '', label: t('messages.filters.all', 'All') },
          { value: 'true', label: t('common.yes', 'Yes') },
          { value: 'false', label: t('common.no', 'No') },
        ],
      },
      {
        id: 'hasAttachments',
        label: t('messages.filters.hasAttachments', 'Attachments'),
        type: 'select',
        options: [
          { value: '', label: t('messages.filters.all', 'All') },
          { value: 'true', label: t('common.yes', 'Yes') },
          { value: 'false', label: t('common.no', 'No') },
        ],
      },
      {
        id: 'hasActions',
        label: t('messages.filters.hasActions', 'Actions'),
        type: 'select',
        options: [
          { value: '', label: t('messages.filters.all', 'All') },
          { value: 'true', label: t('common.yes', 'Yes') },
          { value: 'false', label: t('common.no', 'No') },
        ],
      },
      {
        id: 'senderId',
        label: t('messages.filters.sender', 'Sender'),
        type: 'select',
        options: [{ value: '', label: t('messages.filters.all', 'All') }],
        loadOptions: loadSenderOptions,
      },
      {
        id: 'since',
        label: t('messages.filters.since', 'Sent after'),
        type: 'text',
        placeholder: t('messages.filters.sincePlaceholder', 'YYYY-MM-DDTHH:mm:ssZ'),
      },
    ]
  }, [loadSenderOptions, messageTypesQuery.data, t])

  const columns = React.useMemo<ColumnDef<MessageListItem>[]>(() => [
    {
      accessorKey: 'subject',
      header: t('messages.table.subject', 'Subject'),
      meta: { truncate: true, maxWidth: '360px' },
      cell: ({ row }) => {
        const item = row.original
        const ListItemComponent = resolveMessageListItemComponent(listItemComponentKeyByType[item.type])
        if (ListItemComponent) {
          return (
            <ListItemComponent
              message={{
                id: item.id,
                type: item.type,
                subject: item.subject,
                body: item.bodyPreview,
                bodyFormat: 'text',
                priority: (item.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
                sentAt: item.sentAt ? new Date(item.sentAt) : null,
                senderName: item.senderName || item.senderEmail || item.senderUserId,
                hasObjects: item.hasObjects,
                hasAttachments: item.hasAttachments,
                hasActions: item.hasActions,
                actionTaken: item.actionTaken ?? null,
                unread: item.status === 'unread',
              }}
              onClick={() => router.push(`/backend/messages/${item.id}`)}
            />
          )
        }

        const senderLabel = item.senderName || item.senderEmail || item.senderUserId
        return (
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium">{item.subject}</p>
            <p className="truncate text-xs text-muted-foreground">{item.bodyPreview}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t('messages.table.from', 'From')}: {senderLabel}
            </p>
          </div>
        )
      },
    },
    {
      accessorKey: 'type',
      header: t('messages.table.type', 'Type'),
      cell: ({ row }) => messageTypeLabelMap[row.original.type] ?? row.original.type,
    },
    {
      accessorKey: 'status',
      header: t('messages.table.status', 'Status'),
      cell: ({ row }) => statusToLabel(row.original.status, t),
    },
    {
      accessorKey: 'meta',
      header: t('messages.table.meta', 'Meta'),
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="text-xs text-muted-foreground">
            {item.hasAttachments
              ? t('messages.table.attachmentsCount', '{count} attachments', { count: item.attachmentCount })
              : t('messages.table.noAttachments', 'No attachments')}
            <br />
            {item.hasObjects
              ? t('messages.table.objectsCount', '{count} objects', { count: item.objectCount })
              : t('messages.table.noObjects', 'No objects')}
          </div>
        )
      },
    },
    {
      accessorKey: 'sentAt',
      header: t('messages.table.sentAt', 'Sent'),
      cell: ({ row }) => formatDateTime(row.original.sentAt),
    },
  ], [listItemComponentKeyByType, messageTypeLabelMap, router, t])

  const folderTabs: Array<{ id: MessageFolder; label: string }> = [
    { id: 'inbox', label: t('messages.folder.inbox', 'Inbox') },
    { id: 'sent', label: t('messages.folder.sent', 'Sent') },
    { id: 'drafts', label: t('messages.folder.drafts', 'Drafts') },
    { id: 'archived', label: t('messages.folder.archived', 'Archived') },
    { id: 'all', label: t('messages.folder.all', 'All') },
  ]

  const rows = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = listQuery.data?.totalPages ?? 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {folderTabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            size="sm"
            variant={folder === tab.id ? 'default' : 'outline'}
            onClick={() => {
              setFolder(tab.id)
              setPage(1)
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <DataTable
        title={t('messages.title', 'Messages')}
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('messages.searchPlaceholder', 'Search messages')}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(value) => {
          setFilterValues(value)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        isLoading={listQuery.isLoading || listQuery.isFetching}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        actions={
          <Button asChild>
            <Link href="/backend/messages/compose">{t('messages.compose', 'Compose message')}</Link>
          </Button>
        }
        onRowClick={(row) => {
          router.push(`/backend/messages/${row.id}`)
        }}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'open',
                label: t('messages.actions.open', 'Open'),
                href: `/backend/messages/${row.id}`,
              },
            ]}
          />
        )}
        perspective={{ tableId: 'messages.inbox' }}
      />
    </div>
  )
}
