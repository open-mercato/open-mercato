'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChannelRow = {
  id: string
  providerKey: string
  channelType: string
  displayName: string
  externalIdentifier: string | null
  isPrimary: boolean
  isActive: boolean
  status: 'connected' | 'requires_reauth' | 'error' | 'disconnected'
  lastError: string | null
  pollIntervalSeconds: number | null
  lastPolledAt: string | null
  createdAt: string | null
}

export default function ProfileCommunicationChannelsPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const flashType = searchParams?.get('flash')
  const flashCode = searchParams?.get('code')
  const flashProvider = searchParams?.get('provider')

  const [rows, setRows] = React.useState<ChannelRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    if (flashType === 'connected') {
      flash(
        t(
          'communication_channels.profile.flash.connected',
          `Channel connected${flashProvider ? ` (${flashProvider})` : ''}`,
        ),
        'success',
      )
    } else if (flashType === 'error') {
      flash(
        t(
          'communication_channels.profile.flash.error',
          `Failed to connect channel${flashCode ? ` — ${flashCode}` : ''}`,
        ),
        'error',
      )
    }
  }, [flashType, flashCode, flashProvider, t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setErrorMessage(null)
      const response = await apiCall<{ items?: ChannelRow[] }>(
        '/api/communication_channels/me/channels',
      ).catch((err: unknown) => ({
        ok: false,
        result: { error: err instanceof Error ? err.message : 'Failed to load channels' },
      }))
      if (cancelled) return
      if (!response.ok) {
        const body = response.result as { error?: string } | undefined
        setErrorMessage(
          body?.error ?? t('communication_channels.errors.loadList', 'Failed to load channels'),
        )
        setRows([])
      } else {
        const data = (response.result ?? {}) as { items?: ChannelRow[] }
        setRows(Array.isArray(data.items) ? data.items : [])
      }
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reloadKey, t])

  const reauthRows = rows.filter((r) => r.status === 'requires_reauth')

  const onSetPrimary = React.useCallback(
    async (channelId: string) => {
      const response = await apiCall(
        `/api/communication_channels/channels/${encodeURIComponent(channelId)}/set-primary`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const body = response.result as { error?: string } | undefined
        flash(
          body?.error ?? t('communication_channels.profile.actions.setPrimaryFailed', 'Failed to set as primary'),
          'error',
        )
        return
      }
      flash(
        t('communication_channels.profile.actions.setPrimarySuccess', 'Marked as primary.'),
        'success',
      )
      setReloadKey((k) => k + 1)
    },
    [t],
  )

  const columns = React.useMemo<ColumnDef<ChannelRow>[]>(
    () => [
      {
        header: t('communication_channels.columns.displayName', 'Channel'),
        accessorKey: 'displayName',
      },
      {
        header: t('communication_channels.columns.provider', 'Provider'),
        accessorKey: 'providerKey',
        cell: ({ row }) => (
          <Tag variant="info">
            {t(
              `communication_channels.channel.providers.${row.original.providerKey}`,
              row.original.providerKey,
            )}
          </Tag>
        ),
      },
      {
        header: t('communication_channels.columns.identifier', 'Email / username'),
        accessorKey: 'externalIdentifier',
        cell: ({ row }) => row.original.externalIdentifier ?? '—',
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        header: t('communication_channels.profile.columns.primary', 'Primary'),
        accessorKey: 'isPrimary',
        cell: ({ row }) =>
          row.original.isPrimary ? (
            <Tag variant="success" dot>
              {t('communication_channels.profile.primary', 'Primary')}
            </Tag>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onSetPrimary(row.original.id)}
              aria-label={t('communication_channels.profile.actions.setPrimary', 'Set as primary')}
            >
              {t('communication_channels.profile.actions.setPrimary', 'Set as primary')}
            </Button>
          ),
      },
      {
        header: t('communication_channels.columns.status', 'Status'),
        accessorKey: 'status',
        cell: ({ row }) => statusTag(row.original.status, t),
      },
      {
        header: t('communication_channels.profile.columns.lastPolled', 'Last synced'),
        accessorKey: 'lastPolledAt',
        cell: ({ row }) =>
          row.original.lastPolledAt
            ? new Date(row.original.lastPolledAt).toLocaleString()
            : '—',
      },
    ],
    [onSetPrimary, t],
  )

  return (
    <Page>
      <PageBody>
        <header className="mb-4 flex items-baseline justify-between">
          <div>
            <h2 className="text-2xl font-semibold">
              {t('communication_channels.profile.title', 'My communication channels')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(
                'communication_channels.profile.subtitle',
                'Connect your personal mailbox so outbound messages come from your address and inbound emails land in your unified inbox.',
              )}
            </p>
          </div>
          {/* Provider connect entry points injected by each channel-* package
              (channel-gmail, channel-microsoft, channel-imap) via UMES. */}
          <InjectionSpot
            spotId="profile:communication-channels:connect"
            context={{ reload: () => setReloadKey((k) => k + 1) }}
            data={{}}
          />
        </header>

        {reauthRows.length > 0 ? (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              {t(
                'communication_channels.profile.alerts.requiresReauth',
                `${reauthRows.length} channel(s) need reconnection. Click "Reconnect" on the affected channel below.`,
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <DataTable<ChannelRow>
          title={t('communication_channels.profile.tableTitle', 'Your channels')}
          extensionTableId="communication_channels.profile.channels"
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={errorMessage}
          emptyState={t(
            'communication_channels.profile.empty',
            'You have no connected channels yet. Use the "Connect channel" entry above to add Gmail, Microsoft 365 or IMAP.',
          )}
        />
      </PageBody>
    </Page>
  )
}

function statusTag(
  status: ChannelRow['status'],
  t: (key: string, fallback?: string) => string,
): React.ReactNode {
  switch (status) {
    case 'connected':
      return (
        <Tag variant="success" dot>
          {t('communication_channels.status.connected', 'Connected')}
        </Tag>
      )
    case 'requires_reauth':
      return (
        <Tag variant="warning" dot>
          {t('communication_channels.status.requiresReauth', 'Needs reconnection')}
        </Tag>
      )
    case 'error':
      return (
        <Tag variant="error" dot>
          {t('communication_channels.status.error', 'Error')}
        </Tag>
      )
    case 'disconnected':
      return <Tag variant="neutral">{t('communication_channels.status.disconnected', 'Disconnected')}</Tag>
    default:
      return <Tag variant="neutral">{status}</Tag>
  }
}
