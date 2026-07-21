'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
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
  /** Spec C — push delivery state (null when provider doesn't support push). */
  pushStatus: 'active' | 'inactive' | 'failed' | null
  lastPushError: { code: string | null; message: string | null; at: string | null } | null
  createdAt: string | null
}

const PROFILE_CHANNELS_MUTATION_CONTEXT_ID = 'communication-channels-profile'
const IMPORT_HISTORY_MUTATION_CONTEXT_ID = 'communication-channels-import-history'
const DISCONNECT_MUTATION_CONTEXT_ID = 'communication-channels-disconnect'

type ChannelMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export default function ProfileCommunicationChannelsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const flashType = searchParams?.get('flash')
  const flashCode = searchParams?.get('code')
  const flashProvider = searchParams?.get('provider')

  const [rows, setRows] = React.useState<ChannelRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [importChannel, setImportChannel] = React.useState<ChannelRow | null>(null)
  const [disconnectChannel, setDisconnectChannel] = React.useState<ChannelRow | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<ChannelMutationContext>({
    contextId: PROFILE_CHANNELS_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (flashType === 'connected') {
      flash(
        flashProvider
          ? t('communication_channels.profile.flash.connectedWithProvider', 'Channel connected ({provider}).', {
              provider: flashProvider,
            })
          : t('communication_channels.profile.flash.connected', 'Channel connected.'),
        'success',
      )
    } else if (flashType === 'error') {
      flash(
        flashCode === 'oauth_client_not_configured'
          ? t(
              'communication_channels.profile.connect.notConfigured',
              'This provider is not configured yet. Ask an administrator to add the OAuth Client ID and Secret under Integrations before connecting a mailbox.',
            )
          : flashCode === 'mailbox_already_connected'
            ? t(
                'communication_channels.profile.connect.mailboxAlreadyConnected',
                'This mailbox is already connected through another provider. Disconnect it first to reconnect it with a different one.',
              )
            : flashCode
              ? t('communication_channels.profile.flash.errorWithCode', 'Failed to connect channel — {code}.', {
                  code: flashCode,
                })
              : t('communication_channels.profile.flash.error', 'Failed to connect channel.'),
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
      let response
      try {
        response = await runMutation({
          operation: () => apiCall(
            `/api/communication_channels/channels/${encodeURIComponent(channelId)}/set-primary`,
            { method: 'POST' },
          ),
          context: {
            formId: PROFILE_CHANNELS_MUTATION_CONTEXT_ID,
            resourceKind: 'communication_channels.channel',
            resourceId: channelId,
            retryLastMutation,
          },
          mutationPayload: { isPrimary: true },
        })
      } catch (err) {
        flash(err instanceof Error ? err.message : t('communication_channels.profile.actions.setPrimaryFailed', 'Failed to set as primary'), 'error')
        return
      }
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
    [retryLastMutation, runMutation, t],
  )

  const onRegisterPush = React.useCallback(
    async (channelId: string) => {
      let response
      try {
        response = await runMutation({
          operation: () => apiCall<{ pushStatus?: string; error?: { code: string; message: string } }>(
            `/api/communication_channels/channels/${encodeURIComponent(channelId)}/push/register`,
            { method: 'POST' },
          ),
          context: {
            formId: PROFILE_CHANNELS_MUTATION_CONTEXT_ID,
            resourceKind: 'communication_channels.channel',
            resourceId: channelId,
            retryLastMutation,
          },
          mutationPayload: { action: 'push-register' },
        })
      } catch (err) {
        flash(err instanceof Error ? err.message : t('communication_channels.push.button.reregister', 'Re-register push'), 'error')
        return
      }
      if (!response.ok) {
        const body = response.result as { error?: string } | undefined
        flash(body?.error ?? t('communication_channels.push.flash.registerFailed', 'Failed to register push'), 'error')
        return
      }
      const result = (response.result ?? {}) as { pushStatus?: string }
      if (result.pushStatus === 'active') {
        flash(t('communication_channels.push.status.active', 'Push active'), 'success')
      } else {
        flash(
          t(
            'communication_channels.push.status.failed',
            'Push registration returned a non-active status — falling back to polling.',
          ),
          'error',
        )
      }
      setReloadKey((k) => k + 1)
    },
    [retryLastMutation, runMutation, t],
  )

  const onPollNow = React.useCallback(
    async (channelId: string) => {
      let response
      try {
        response = await runMutation({
          operation: () => apiCall(
            `/api/communication_channels/channels/${encodeURIComponent(channelId)}/poll-now`,
            { method: 'POST' },
          ),
          context: {
            formId: PROFILE_CHANNELS_MUTATION_CONTEXT_ID,
            resourceKind: 'communication_channels.channel',
            resourceId: channelId,
            retryLastMutation,
          },
          mutationPayload: { action: 'poll-now' },
        })
      } catch (err) {
        flash(err instanceof Error ? err.message : t('communication_channels.profile.actions.pollNowFailed', 'Failed to trigger poll'), 'error')
        return
      }
      if (!response.ok) {
        const body = response.result as { error?: string } | undefined
        flash(
          body?.error ?? t('communication_channels.profile.actions.pollNowFailed', 'Failed to trigger poll'),
          'error',
        )
        return
      }
      flash(
        t(
          'communication_channels.profile.actions.pollNowSuccess',
          'Poll triggered — new messages will appear on linked Person timelines in a few seconds.',
        ),
        'success',
      )
      // Give the worker a moment to fetch + ingest, then refetch our channel list
      // so `lastPolledAt` updates in the UI.
      setTimeout(() => setReloadKey((k) => k + 1), 1500)
    },
    [retryLastMutation, runMutation, t],
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
        id: 'pushStatus',
        header: t('communication_channels.push.status.active', 'Push'),
        cell: ({ row }) => {
          const supportsPush = row.original.providerKey === 'gmail'
          if (!supportsPush) {
            return (
              <span className="text-xs text-muted-foreground">
                {t('communication_channels.push.status.inactive', 'Polling only')}
              </span>
            )
          }
          const ps = row.original.pushStatus
          if (ps === 'active') {
            return (
              <Tag variant="success" dot>
                {t('communication_channels.push.status.active', 'Push active')}
              </Tag>
            )
          }
          if (ps === 'failed') {
            const errorMsg = row.original.lastPushError?.message ?? null
            return (
              <div className="flex items-center gap-2">
                <Tag variant="error" dot>
                  {t('communication_channels.push.status.failed', 'Push failed — using polling')}
                </Tag>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onRegisterPush(row.original.id)}
                  aria-label={t('communication_channels.push.button.reregister', 'Re-register push')}
                  title={errorMsg ?? undefined}
                >
                  {t('communication_channels.push.button.reregister', 'Re-register push')}
                </Button>
              </div>
            )
          }
          // null or 'inactive' — provider supports push but not registered yet.
          return (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t('communication_channels.push.status.inactive', 'Polling only')}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onRegisterPush(row.original.id)}
                aria-label={t('communication_channels.push.button.reregister', 'Re-register push')}
              >
                {t('communication_channels.push.button.reregister', 'Re-register push')}
              </Button>
            </div>
          )
        },
      },
      {
        header: t('communication_channels.profile.columns.lastPolled', 'Last synced'),
        accessorKey: 'lastPolledAt',
        cell: ({ row }) =>
          row.original.lastPolledAt
            ? new Date(row.original.lastPolledAt).toLocaleString()
            : '—',
      },
      {
        id: 'importHistory',
        header: t('communication_channels.profile.columns.importHistory', 'History'),
        cell: ({ row }) => {
          const eligible =
            row.original.isActive &&
            row.original.status === 'connected' &&
            row.original.channelType === 'email'
          const label = t('communication_channels.profile.actions.importHistory', 'Import history')
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImportChannel(row.original)}
              disabled={!eligible}
              aria-label={label}
            >
              {label}
            </Button>
          )
        },
      },
      {
        id: 'pollNow',
        header: t('communication_channels.profile.columns.pollNow', 'Sync'),
        cell: ({ row }) => {
          // Allowed from 'connected' AND 'error' — the latter lets the user
          // recover a stuck channel without disconnecting + reconnecting.
          // 'requires_reauth' and 'disconnected' are owned by other flows.
          const pollable =
            row.original.isActive &&
            (row.original.status === 'connected' || row.original.status === 'error')
          const label =
            row.original.status === 'error'
              ? t('communication_channels.profile.actions.retryPoll', 'Retry')
              : t('communication_channels.profile.actions.pollNow', 'Poll now')
          return (
            <Button
              type="button"
              variant={row.original.status === 'error' ? 'default' : 'outline'}
              size="sm"
              onClick={() => void onPollNow(row.original.id)}
              disabled={!pollable}
              aria-label={label}
            >
              {label}
            </Button>
          )
        },
      },
      {
        id: 'disconnect',
        header: t('communication_channels.profile.columns.disconnect', 'Connection'),
        cell: ({ row }) => {
          const label = t('communication_channels.profile.actions.disconnect', 'Disconnect')
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDisconnectChannel(row.original)}
              aria-label={label}
            >
              {label}
            </Button>
          )
        },
      },
    ],
    [onSetPrimary, onPollNow, onRegisterPush, t],
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
              (channel-gmail, channel-imap) via UMES. */}
          <InjectionSpot
            spotId="profile:communication-channels:connect"
            context={{ reload: () => setReloadKey((k) => k + 1) }}
            data={{}}
          />
        </header>

        {reauthRows.length > 0 ? (
          <Alert status="warning" className="mb-4">
            <AlertDescription>
              {t(
                'communication_channels.profile.alerts.requiresReauth',
                '{count} channel(s) need reconnection. Click "Reconnect" on the affected channel below.',
                { count: reauthRows.length },
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
            'You have no connected channels yet. Use the "Connect channel" entry above to add Gmail or IMAP.',
          )}
        />
        <ImportHistoryDialog
          channel={importChannel}
          onClose={() => setImportChannel(null)}
          onQueued={() => {
            setImportChannel(null)
            router.refresh()
          }}
        />
        <DisconnectChannelDialog
          channel={disconnectChannel}
          onClose={() => setDisconnectChannel(null)}
          onDisconnected={() => {
            setDisconnectChannel(null)
            setReloadKey((k) => k + 1)
          }}
        />
      </PageBody>
    </Page>
  )
}

type ImportHistoryDialogProps = {
  channel: ChannelRow | null
  onClose: () => void
  onQueued: () => void
}

function ImportHistoryDialog({ channel, onClose, onQueued }: ImportHistoryDialogProps): React.JSX.Element {
  const t = useT()
  const [sinceDays, setSinceDays] = React.useState('30')
  const [contactEmails, setContactEmails] = React.useState('')
  const [maxMessages, setMaxMessages] = React.useState('500')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<ChannelMutationContext>({
    contextId: IMPORT_HISTORY_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (channel) {
      setSinceDays('30')
      setContactEmails('')
      setMaxMessages('500')
      setFieldErrors({})
      setSubmitting(false)
    }
  }, [channel?.id])

  const handleSubmit = React.useCallback(async () => {
    if (!channel || submitting) return
    const sinceNum = Number.parseInt(sinceDays, 10)
    const maxNum = Number.parseInt(maxMessages, 10)
    const errors: Record<string, string> = {}
    if (!Number.isFinite(sinceNum) || sinceNum < 1 || sinceNum > 365) {
      errors.sinceDays = t(
        'communication_channels.profile.importHistory.errors.sinceDays',
        'Choose a number between 1 and 365 days.',
      )
    }
    if (!Number.isFinite(maxNum) || maxNum < 1 || maxNum > 5000) {
      errors.maxMessages = t(
        'communication_channels.profile.importHistory.errors.maxMessages',
        'Choose a number between 1 and 5000 messages.',
      )
    }
    const parsedEmails = contactEmails
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parsedEmails.length > 0 && parsedEmails.some((s) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) {
      errors.contactEmails = t(
        'communication_channels.profile.importHistory.errors.contactEmails',
        'One or more entries is not a valid email address.',
      )
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    setSubmitting(true)
    const mutationPayload = {
      sinceDays: sinceNum,
      maxMessages: maxNum,
      ...(parsedEmails.length > 0 ? { contactEmails: parsedEmails } : {}),
    }
    let response
    try {
      response = await runMutation({
        operation: () => apiCall<{ progressJobId?: string }>(
          `/api/communication_channels/channels/${encodeURIComponent(channel.id)}/import-history`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(mutationPayload),
          },
        ),
        context: {
          formId: IMPORT_HISTORY_MUTATION_CONTEXT_ID,
          resourceKind: 'communication_channels.channel',
          resourceId: channel.id,
          retryLastMutation,
        },
        mutationPayload,
      })
    } catch (err) {
      setSubmitting(false)
      flash(
        err instanceof Error
          ? err.message
          : t('communication_channels.profile.importHistory.flash.error', 'Failed to queue history import.'),
        'error',
      )
      return
    }
    setSubmitting(false)
    if (!response.ok) {
      const body = response.result as { error?: string; fieldErrors?: Record<string, string> } | undefined
      if (body?.fieldErrors && Object.keys(body.fieldErrors).length > 0) {
        setFieldErrors(body.fieldErrors)
        return
      }
      flash(
        body?.error ??
          t(
            'communication_channels.profile.importHistory.flash.error',
            'Failed to queue history import.',
          ),
        'error',
      )
      return
    }
    flash(
      t(
        'communication_channels.profile.importHistory.flash.success',
        'History import queued — track progress in the top bar.',
      ),
      'success',
    )
    onQueued()
  }, [channel, sinceDays, maxMessages, contactEmails, submitting, t, onQueued, retryLastMutation, runMutation])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <Dialog open={channel !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('communication_channels.profile.importHistory.title', 'Import channel history')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'communication_channels.profile.importHistory.description',
              'Pull older messages this channel never observed at connect-time. Filters narrow the search server-side.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="import-history-since">
              {t('communication_channels.profile.importHistory.fields.sinceDays', 'Look back (days)')}
            </Label>
            <Input
              id="import-history-since"
              type="number"
              min={1}
              max={365}
              value={sinceDays}
              onChange={(e) => setSinceDays(e.target.value)}
              aria-invalid={Boolean(fieldErrors.sinceDays)}
            />
            {fieldErrors.sinceDays ? (
              <p className="text-xs text-status-error-text">{fieldErrors.sinceDays}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="import-history-emails">
              {t(
                'communication_channels.profile.importHistory.fields.contactEmails',
                'Filter by sender (optional)',
              )}
            </Label>
            <Textarea
              id="import-history-emails"
              rows={3}
              value={contactEmails}
              onChange={(e) => setContactEmails(e.target.value)}
              placeholder={t(
                'communication_channels.profile.importHistory.fields.contactEmailsPlaceholder',
                'alice@example.com, bob@example.com',
              )}
              aria-invalid={Boolean(fieldErrors.contactEmails)}
            />
            {fieldErrors.contactEmails ? (
              <p className="text-xs text-status-error-text">{fieldErrors.contactEmails}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t(
                  'communication_channels.profile.importHistory.fields.contactEmailsHint',
                  'Leave empty to scan all senders in the window.',
                )}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="import-history-max">
              {t('communication_channels.profile.importHistory.fields.maxMessages', 'Maximum messages')}
            </Label>
            <Input
              id="import-history-max"
              type="number"
              min={1}
              max={5000}
              value={maxMessages}
              onChange={(e) => setMaxMessages(e.target.value)}
              aria-invalid={Boolean(fieldErrors.maxMessages)}
            />
            {fieldErrors.maxMessages ? (
              <p className="text-xs text-status-error-text">{fieldErrors.maxMessages}</p>
            ) : null}
          </div>

          {fieldErrors.channelId ? (
            <Alert status="warning">
              <AlertDescription>{fieldErrors.channelId}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            <KbdShortcut keys={['⌘', 'Enter']} />
          </span>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('communication_channels.profile.importHistory.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting
              ? t('communication_channels.profile.importHistory.submitting', 'Queueing…')
              : t('communication_channels.profile.importHistory.submit', 'Start import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DisconnectChannelDialogProps = {
  channel: ChannelRow | null
  onClose: () => void
  onDisconnected: () => void
}

function DisconnectChannelDialog({
  channel,
  onClose,
  onDisconnected,
}: DisconnectChannelDialogProps): React.JSX.Element {
  const t = useT()
  const [submitting, setSubmitting] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<ChannelMutationContext>({
    contextId: DISCONNECT_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (channel) setSubmitting(false)
  }, [channel?.id])

  const handleConfirm = React.useCallback(async () => {
    if (!channel || submitting) return
    setSubmitting(true)
    let response
    try {
      response = await runMutation({
        // optimistic-lock-exempt: self-service connect/disconnect of the
        // signed-in operator's OWN communication channel (an integration link),
        // not a shared multi-editor record. Disconnect is a terminal action
        // keyed by channel id; there is no concurrent-edit lost-update window to
        // guard, and the row carries no client-surfaced `updatedAt` round-trip.
        operation: () => apiCall(
          `/api/communication_channels/channels/${encodeURIComponent(channel.id)}`,
          { method: 'DELETE' },
        ),
        context: {
          formId: DISCONNECT_MUTATION_CONTEXT_ID,
          resourceKind: 'communication_channels.channel',
          resourceId: channel.id,
          retryLastMutation,
        },
        mutationPayload: { action: 'disconnect' },
      })
    } catch (err) {
      setSubmitting(false)
      flash(
        err instanceof Error
          ? err.message
          : t('communication_channels.profile.actions.disconnectFailed', 'Failed to disconnect channel'),
        'error',
      )
      return
    }
    setSubmitting(false)
    if (!response.ok) {
      const body = response.result as { error?: string } | undefined
      flash(
        body?.error ??
          t('communication_channels.profile.actions.disconnectFailed', 'Failed to disconnect channel'),
        'error',
      )
      return
    }
    flash(
      t(
        'communication_channels.profile.actions.disconnectSuccess',
        'Channel disconnected. You can reconnect it anytime.',
      ),
      'success',
    )
    onDisconnected()
  }, [channel, submitting, runMutation, retryLastMutation, t, onDisconnected])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleConfirm()
      }
    },
    [handleConfirm],
  )

  return (
    <Dialog open={channel !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('communication_channels.profile.disconnect.title', 'Disconnect channel')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'communication_channels.profile.disconnect.description',
              'This removes the connection and stops syncing. Emails already imported stay on your timelines. You can reconnect anytime.',
            )}
          </DialogDescription>
        </DialogHeader>

        {channel ? (
          <p className="text-sm font-medium">{channel.externalIdentifier ?? channel.displayName}</p>
        ) : null}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            <KbdShortcut keys={['⌘', 'Enter']} />
          </span>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('communication_channels.profile.disconnect.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void handleConfirm()} disabled={submitting}>
            {submitting
              ? t('communication_channels.profile.disconnect.submitting', 'Disconnecting…')
              : t('communication_channels.profile.disconnect.confirm', 'Disconnect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
