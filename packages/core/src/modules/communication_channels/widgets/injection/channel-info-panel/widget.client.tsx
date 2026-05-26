'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChannelEnrichment = {
  providerKey: string
  channelType: string
  direction: 'inbound' | 'outbound' | string
  deliveryStatus: string | null
}

type ChannelContactEnrichment = {
  contactPersonId: string | null
  assignedUserId: string | null
  subject: string | null
}

type MessageWithChannelContext = Record<string, unknown> & {
  id?: string
  threadId?: string | null
  _channel?: ChannelEnrichment | null
  _channelContact?: ChannelContactEnrichment | null
}

type WidgetContext = Record<string, unknown> & {
  /**
   * Set when the host (e.g. message detail page) provides the current user's
   * feature grants. The reassignment editor is hidden when
   * `communication_channels.assign` is not present. Wildcard grants
   * (`*` and `communication_channels.*`) are honored too.
   */
  userFeatures?: string[]
}

type UserOption = { id: string; label: string }

const FEATURE_GATE = 'communication_channels.assign'

export default function ChannelInfoPanelWidget({
  data,
  context,
}: InjectionWidgetComponentProps<WidgetContext, MessageWithChannelContext>) {
  const t = useT()
  const channel = data?._channel ?? null
  const contact = data?._channelContact ?? null

  const canReassign = Array.isArray(context?.userFeatures)
    ? context!.userFeatures!.some(
        (feature) =>
          feature === FEATURE_GATE || feature === '*' || feature === 'communication_channels.*',
      )
    : false

  const [assignedUserId, setAssignedUserId] = React.useState<string | null>(
    contact?.assignedUserId ?? null,
  )
  const [savingAssignee, setSavingAssignee] = React.useState(false)
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [usersLoaded, setUsersLoaded] = React.useState(false)

  React.useEffect(
    () => setAssignedUserId(contact?.assignedUserId ?? null),
    [contact?.assignedUserId],
  )

  const loadUsers = React.useCallback(async () => {
    if (usersLoaded || !canReassign) return
    const response = await apiCall<{
      items?: Array<{ id: string; email?: string | null; name?: string | null }>
    }>('/api/auth/users?page=1&pageSize=50').catch(() => null)
    if (!response || !response.ok) {
      setUsersLoaded(true)
      return
    }
    const items = (response.result?.items ?? []).flatMap<UserOption>((u) => {
      if (!u?.id) return []
      const label =
        (typeof u.name === 'string' && u.name.trim().length > 0 && u.name.trim()) ||
        (typeof u.email === 'string' && u.email.trim().length > 0 && u.email.trim()) ||
        u.id
      return [{ id: u.id, label }]
    })
    setUsers(items)
    setUsersLoaded(true)
  }, [canReassign, usersLoaded])

  const reassign = React.useCallback(
    async (nextAssignedUserId: string | null) => {
      const threadId = data?.threadId
      if (!threadId) {
        flash(
          t(
            'communication_channels.infoPanel.noThread',
            'This message is not on a thread; reassignment unavailable.',
          ),
          'error',
        )
        return
      }
      setSavingAssignee(true)
      try {
        const response = await apiCall<{ assignedUserId: string | null }>(
          `/api/communication_channels/threads/${encodeURIComponent(threadId)}/assign`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assignedUserId: nextAssignedUserId }),
          },
        )
        if (!response.ok) {
          const body = response.result as { error?: string } | undefined
          flash(
            body?.error ??
              t('communication_channels.infoPanel.reassignError', 'Reassignment failed'),
            'error',
          )
          return
        }
        setAssignedUserId(nextAssignedUserId)
        flash(
          t('communication_channels.infoPanel.reassignSuccess', 'Conversation reassigned.'),
          'success',
        )
      } finally {
        setSavingAssignee(false)
      }
    },
    [data?.threadId, t],
  )

  if (!channel) return null

  return (
    <aside
      className="rounded-md border bg-card p-4 text-sm"
      aria-label={t('communication_channels.infoPanel.aria', 'Channel info')}
    >
      <header className="mb-2 text-overline text-muted-foreground">
        {t('communication_channels.infoPanel.title', 'Channel info')}
      </header>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        <dt className="text-muted-foreground">
          {t('communication_channels.infoPanel.provider', 'Provider')}
        </dt>
        <dd>{channel.providerKey}</dd>

        <dt className="text-muted-foreground">
          {t('communication_channels.infoPanel.type', 'Type')}
        </dt>
        <dd>{channel.channelType}</dd>

        <dt className="text-muted-foreground">
          {t('communication_channels.infoPanel.direction', 'Direction')}
        </dt>
        <dd>{channel.direction}</dd>

        {channel.deliveryStatus ? (
          <>
            <dt className="text-muted-foreground">
              {t('communication_channels.infoPanel.status', 'Status')}
            </dt>
            <dd>{channel.deliveryStatus}</dd>
          </>
        ) : null}

        {contact?.contactPersonId ? (
          <>
            <dt className="text-muted-foreground">
              {t('communication_channels.infoPanel.contactPerson', 'CRM contact')}
            </dt>
            <dd className="truncate" title={contact.contactPersonId}>
              {contact.contactPersonId}
            </dd>
          </>
        ) : null}

        {contact?.subject ? (
          <>
            <dt className="text-muted-foreground">
              {t('communication_channels.infoPanel.subject', 'Subject')}
            </dt>
            <dd className="col-span-2 truncate" title={contact.subject}>
              {contact.subject}
            </dd>
          </>
        ) : null}

        <dt className="text-muted-foreground">
          {t('communication_channels.infoPanel.assignedTo', 'Assigned to')}
        </dt>
        <dd className="col-span-1">
          {canReassign ? (
            <select
              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
              value={assignedUserId ?? ''}
              onFocus={() => void loadUsers()}
              onChange={(event) =>
                void reassign(event.target.value === '' ? null : event.target.value)
              }
              disabled={savingAssignee || !data?.threadId}
              aria-label={t('communication_channels.infoPanel.assignedTo', 'Assigned to')}
            >
              <option value="">
                {t('communication_channels.infoPanel.unassigned', 'Unassigned')}
              </option>
              {assignedUserId && !users.some((u) => u.id === assignedUserId) ? (
                <option value={assignedUserId}>{assignedUserId}</option>
              ) : null}
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate" title={assignedUserId ?? ''}>
              {assignedUserId ?? t('communication_channels.infoPanel.unassigned', 'Unassigned')}
            </span>
          )}
        </dd>
      </dl>
    </aside>
  )
}
