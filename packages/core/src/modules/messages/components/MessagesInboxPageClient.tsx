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
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Archive, ChevronDown, FilePenLine, Inbox, Layers, Send } from 'lucide-react'
import { resolveMessageListItemComponent } from './utils/typeUiRegistry'
import { DefaultMessageListItem } from './defaults/DefaultMessageListItem'

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

export function MessagesInboxPageClient() {
  const router = useRouter()
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [folder, setFolder] = React.useState<MessageFolder>('inbox')
  const [folderMenuOpen, setFolderMenuOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const pageSize = 20
  const folderMenuRef = React.useRef<HTMLDivElement | null>(null)

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
      accessorKey: 'message',
      header: t('messages.title', 'Messages'),
      meta: {
        truncate: false,
        maxWidth: '100%',
      },
      cell: ({ row }) => {
        const item = row.original
        const ListItemComponent = resolveMessageListItemComponent(listItemComponentKeyByType[item.type])
        const ComponentToUse = ListItemComponent || DefaultMessageListItem

        return (
          <ComponentToUse
            message={{
              id: item.id,
              type: item.type,
              typeLabel: messageTypeLabelMap[item.type] ?? item.type,
              subject: item.subject,
              body: item.bodyPreview,
              bodyFormat: 'text' as const,
              priority: (item.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
              sentAt: item.sentAt ? new Date(item.sentAt) : null,
              senderName: item.senderName || item.senderEmail || item.senderUserId,
              hasObjects: item.hasObjects,
              objectCount: item.objectCount,
              hasAttachments: item.hasAttachments,
              attachmentCount: item.attachmentCount,
              hasActions: item.hasActions,
              actionTaken: item.actionTaken ?? null,
              unread: item.status === 'unread',
            }}
            onClick={() => router.push(`/backend/messages/${item.id}`)}
          />
        )
      },
    },
  ], [listItemComponentKeyByType, messageTypeLabelMap, router, t])

  const folderOptions = React.useMemo(() => [
    { id: 'inbox' as const, label: t('messages.folder.inbox', 'Inbox'), icon: Inbox },
    { id: 'sent' as const, label: t('messages.folder.sent', 'Sent'), icon: Send },
    { id: 'drafts' as const, label: t('messages.folder.drafts', 'Drafts'), icon: FilePenLine },
    { id: 'archived' as const, label: t('messages.folder.archived', 'Archived'), icon: Archive },
    { id: 'all' as const, label: t('messages.folder.all', 'All'), icon: Layers },
  ], [t])

  const activeFolderOption = folderOptions.find((option) => option.id === folder) ?? folderOptions[0]
  const ActiveFolderIcon = activeFolderOption.icon

  React.useEffect(() => {
    if (!folderMenuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (!folderMenuRef.current) return
      const target = event.target
      if (target instanceof Node && !folderMenuRef.current.contains(target)) {
        setFolderMenuOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFolderMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [folderMenuOpen])

  const rows = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = listQuery.data?.totalPages ?? 1

  return (
    <div className="space-y-4">
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={folderMenuRef}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                aria-expanded={folderMenuOpen}
                aria-haspopup="menu"
                onClick={() => setFolderMenuOpen((value) => !value)}
              >
                <ActiveFolderIcon className="h-4 w-4" aria-hidden />
                <span>{t('messages.folder.selector', 'Folder')}:</span>
                <span>{activeFolderOption.label}</span>
                <ChevronDown className="h-4 w-4 opacity-70" aria-hidden />
              </Button>
              {folderMenuOpen ? (
                <div
                  className="absolute right-0 z-20 mt-1 min-w-52 rounded-md border bg-background p-1 shadow"
                  role="menu"
                >
                  {folderOptions.map((option) => {
                    const Icon = option.icon
                    const isActive = option.id === folder
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${isActive ? 'bg-accent/60' : ''}`}
                        onClick={() => {
                          setFolder(option.id)
                          setPage(1)
                          setFolderMenuOpen(false)
                        }}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        <span>{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <Button asChild>
              <Link href="/backend/messages/compose">{t('messages.compose', 'Compose message')}</Link>
            </Button>
          </div>
        }
        onRowClick={(row) => {
          router.push(`/backend/messages/${row.id}`)
        }}
        perspective={{ tableId: 'messages.inbox' }}
        embedded
      />
    </div>
  )
}
