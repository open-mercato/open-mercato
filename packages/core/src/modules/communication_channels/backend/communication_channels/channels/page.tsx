'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChannelRow = {
  id: string
  providerKey: string
  channelType: string
  displayName: string
  externalIdentifier: string | null
  isActive: boolean
  capabilities: Record<string, unknown> | null
  createdAt: string | null
}

type ChannelListResponse = {
  items?: ChannelRow[]
  total?: number
  totalPages?: number
}

export default function ChannelsListPage() {
  const t = useT()
  const [rows, setRows] = React.useState<ChannelRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  // Bumped by injected connect widgets (FCM/APNs/Expo) so a freshly connected
  // tenant-wide channel appears without a manual page reload.
  const [reloadToken, setReloadToken] = React.useState(0)
  const pageSize = 50

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])
  const injectionContext = React.useMemo(
    () => ({ tableId: 'communication_channels.channels', reload }),
    [reload],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setErrorMessage(null)
      const response = await apiCall<ChannelListResponse>(
        `/api/communication_channels/channels?page=${page}&pageSize=${pageSize}`,
      ).catch((err: unknown) => {
        return {
          ok: false,
          result: { error: err instanceof Error ? err.message : 'Failed to load channels' },
        }
      })
      if (cancelled) return
      if (!response.ok) {
        const errBody = response.result as { error?: string } | undefined
        setErrorMessage(
          errBody?.error ?? t('communication_channels.errors.loadList', 'Failed to load channels'),
        )
        setRows([])
        setTotal(0)
        setTotalPages(1)
      } else {
        const data = (response.result ?? {}) as ChannelListResponse
        setRows(Array.isArray(data.items) ? data.items : [])
        setTotal(typeof data.total === 'number' ? data.total : 0)
        setTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1)
      }
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [page, reloadToken, t])

  const columns = React.useMemo<ColumnDef<ChannelRow>[]>(
    () => [
      {
        header: t('communication_channels.columns.displayName', 'Channel'),
        accessorKey: 'displayName',
      },
      {
        header: t('communication_channels.columns.provider', 'Provider'),
        accessorKey: 'providerKey',
      },
      {
        header: t('communication_channels.columns.type', 'Type'),
        accessorKey: 'channelType',
      },
      {
        header: t('communication_channels.columns.identifier', 'External ID'),
        accessorKey: 'externalIdentifier',
        cell: ({ row }) => row.original.externalIdentifier ?? '—',
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        header: t('communication_channels.columns.status', 'Status'),
        accessorKey: 'isActive',
        cell: ({ row }) =>
          row.original.isActive ? (
            <Tag variant="success" dot>
              {t('communication_channels.status.active', 'Active')}
            </Tag>
          ) : (
            <Tag variant="neutral">
              {t('communication_channels.status.inactive', 'Inactive')}
            </Tag>
          ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<ChannelRow>
          title={t('communication_channels.nav.title', 'Communication Channels')}
          extensionTableId="communication_channels.channels"
          injectionContext={injectionContext}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={errorMessage}
          emptyState={t(
            'communication_channels.emptyState',
            'No shared channels yet. This page lists shared, tenant-wide channels. Your personal email mailbox is private — connect and manage it under Profile → Communication Channels.',
          )}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
      </PageBody>
    </Page>
  )
}
