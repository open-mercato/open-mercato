"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { Archive, ChevronDown, FilePenLine, Inbox, Layers, Send } from 'lucide-react'
import { getMessageUiComponentRegistry } from './utils/typeUiRegistry'
import { DefaultMessageListItem } from './defaults/DefaultMessageListItem'
import { getMessageListParticipantLabel } from './messageListLabels'
import { toErrorMessage } from './message-detail/utils'
import { useMessagesInboxBulkActions, type MessageFolder } from './useMessagesInboxBulkActions'
import {
  buildMessagesInboxFilters,
  buildMessagesListParams,
  type SenderOption,
} from './inboxFilters'

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
  recipientCount?: number
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

export function MessagesInboxPageClient() {
  const router = useRouter()
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()

  const invalidateMessageListQueries = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['messages', 'list'] })
  }, [queryClient])

  useAppEvent('messages.message.*', invalidateMessageListQueries, [invalidateMessageListQueries])

  useAppEvent('om:bridge:reconnected', invalidateMessageListQueries, [invalidateMessageListQueries])

  const [folder, setFolder] = React.useState<MessageFolder>('inbox')
  const [folderMenuOpen, setFolderMenuOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const pageSize = 20
  const folderMenuRef = React.useRef<HTMLDivElement | null>(null)
  const messageUiRegistry = React.useMemo(() => getMessageUiComponentRegistry(), [])
  const { bulkActions, selectionScopeKey, injectionContext, ConfirmDialogElement } = useMessagesInboxBulkActions<MessageListItem>({
    folder,
    page,
    search,
    filterValues,
  })

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
      const params = buildMessagesListParams({
        folder,
        page,
        pageSize,
        search,
        filterValues,
      })

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
        totalPages: Number(call.result?.totalPages ?? 0),
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

  const [senderOptions, setSenderOptions] = React.useState<SenderOption[]>([])
  const senderOptionsScopeRef = React.useRef(scopeVersion)

  const mergeSenderOptions = React.useCallback((incoming: SenderOption[]) => {
    if (incoming.length === 0) return
    setSenderOptions((prev) => {
      const map = new Map<string, SenderOption>()
      for (const opt of prev) map.set(opt.value, opt)
      for (const opt of incoming) map.set(opt.value, opt)
      return Array.from(map.values())
    })
  }, [])

  const loadSenderOptions = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', '20')
    if (query && query.trim().length > 0) {
      params.set('search', query.trim())
    }

    const call = await apiCall<{ items?: UserListItem[] }>(
      `/api/auth/users?${params.toString()}`,
      {
        headers: {
          'x-om-forbidden-redirect': '0',
        },
      },
    ).catch(() => null)
    if (!call) return []
    if (!call.ok) return []

    const items = Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
    const next: SenderOption[] = items.flatMap((item) => {
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
    if (senderOptionsScopeRef.current === scopeVersion) {
      mergeSenderOptions(next)
    }
    return next
  }, [mergeSenderOptions, scopeVersion])

  React.useEffect(() => {
    const items = listQuery.data?.items ?? []
    const next = items.flatMap((item): SenderOption[] => {
      if (typeof item.senderUserId !== 'string' || item.senderUserId.trim().length === 0) return []
      const name = typeof item.senderName === 'string' && item.senderName.trim().length > 0
        ? item.senderName.trim()
        : null
      const email = typeof item.senderEmail === 'string' && item.senderEmail.trim().length > 0
        ? item.senderEmail.trim()
        : null
      const label = name ?? email ?? item.senderUserId
      return [{
        value: item.senderUserId,
        label,
        description: email && email !== label ? email : null,
      }]
    })
    mergeSenderOptions(next)
  }, [listQuery.data?.items, mergeSenderOptions])

  React.useEffect(() => {
    senderOptionsScopeRef.current = scopeVersion
    setSenderOptions([])
    loadSenderOptions().catch((error: unknown) => {
      console.warn('[messages] Failed to load sender filter options', error)
    })
  }, [loadSenderOptions, scopeVersion])

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

    return buildMessagesInboxFilters({
      t,
      typeOptions,
      senderOptions,
      loadSenderOptions,
    })
  }, [loadSenderOptions, messageTypesQuery.data, senderOptions, t])

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
        const listItemComponentKey = listItemComponentKeyByType[item.type]
        const ListItemComponent = listItemComponentKey
          ? messageUiRegistry.listItemComponents[listItemComponentKey] ?? null
          : null
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
              senderName: getMessageListParticipantLabel(item, folder, t),
              hasObjects: item.hasObjects,
              objectCount: item.objectCount,
              hasAttachments: item.hasAttachments,
              attachmentCount: item.attachmentCount,
              recipientCount: item.recipientCount ?? 0,
              hasActions: item.hasActions,
              actionTaken: item.actionTaken ?? null,
              unread: item.status === 'unread',
            }}
            onClick={() => router.push(`/backend/messages/${item.id}`)}
          />
        )
      },
    },
  ], [folder, listItemComponentKeyByType, messageTypeLabelMap, messageUiRegistry, router, t])

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
  const totalPages = listQuery.data?.totalPages ?? 0

  return (
    <div className="space-y-4">
      <DataTable
        title={t('messages.title', 'Messages')}
        columns={columns}
        data={rows}
        bulkActions={bulkActions}
        selectionScopeKey={selectionScopeKey}
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
        injectionContext={injectionContext}
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
                  className="absolute right-0 z-dropdown mt-1 min-w-52 rounded-md border bg-background p-1 shadow"
                  role="menu"
                >
                  {folderOptions.map((option) => {
                    const Icon = option.icon
                    const isActive = option.id === folder
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        role="menuitemradio"
                        aria-checked={isActive}
                        className={`w-full justify-start h-auto px-2 py-1.5 text-sm font-normal ${isActive ? 'bg-accent/60' : ''}`}
                        onClick={() => {
                          setFolder(option.id)
                          setPage(1)
                          setFolderMenuOpen(false)
                        }}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        <span>{option.label}</span>
                      </Button>
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
        embedded
      />
      {ConfirmDialogElement}
    </div>
  )
}
