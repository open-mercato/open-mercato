'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { hasFeature } from '@open-mercato/shared/security/features'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

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
type UserLookup = { id: string; email?: string | null; name?: string | null }

function userLabel(user: UserLookup): string {
  return (
    (typeof user.name === 'string' && user.name.trim()) ||
    (typeof user.email === 'string' && user.email.trim()) ||
    user.id
  )
}

const FEATURE_GATE = 'communication_channels.assign'
const CHANNEL_INFO_MUTATION_CONTEXT_ID = 'communication-channels-info-panel'
// Radix Select reserves '' for "no selection"; use a sentinel for Unassigned.
const UNASSIGNED_VALUE = '__unassigned__'

type ChannelInfoMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export default function ChannelInfoPanelWidget({
  data,
  context,
}: InjectionWidgetComponentProps<WidgetContext, MessageWithChannelContext>) {
  const t = useT()
  const channel = data?._channel ?? null
  const contact = data?._channelContact ?? null
  const { runMutation, retryLastMutation } = useGuardedMutation<ChannelInfoMutationContext>({
    contextId: CHANNEL_INFO_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const canReassign = hasFeature(context?.userFeatures ?? [], FEATURE_GATE)

  const [assignedUserId, setAssignedUserId] = React.useState<string | null>(
    contact?.assignedUserId ?? null,
  )
  const [savingAssignee, setSavingAssignee] = React.useState(false)
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [usersLoaded, setUsersLoaded] = React.useState(false)
  const usersRequestedRef = React.useRef(false)
  const [assigneeLabels, setAssigneeLabels] = React.useState<Record<string, string>>({})
  const requestedAssigneeIdsRef = React.useRef(new Set<string>())

  React.useEffect(
    () => setAssignedUserId(contact?.assignedUserId ?? null),
    [contact?.assignedUserId],
  )

  const loadUsers = React.useCallback(async () => {
    if (usersLoaded || usersRequestedRef.current || !canReassign) return
    usersRequestedRef.current = true
    const response = await apiCall<{
      items?: UserLookup[]
    }>('/api/auth/users?page=1&pageSize=50', {
      // Opportunistic dropdown-options fetch: a user may hold
      // `communication_channels.assign` without `auth.users.list`. Suppress the
      // global 403/401 redirect + forbidden flash so the page degrades to an
      // empty assignee list instead of bouncing the whole browser to /login.
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    }).catch(() => null)
    if (!response || !response.ok) {
      setUsersLoaded(true)
      return
    }
    const items = (response.result?.items ?? []).flatMap<UserOption>((user) => {
      if (!user?.id) return []
      return [{ id: user.id, label: userLabel(user) }]
    })
    setUsers(items)
    setUsersLoaded(true)
  }, [canReassign, usersLoaded])

  React.useEffect(() => {
    if (assignedUserId) void loadUsers()
  }, [assignedUserId, loadUsers])

  React.useEffect(() => {
    if (!canReassign || !usersLoaded || !assignedUserId) return
    if (users.some((user) => user.id === assignedUserId)) return
    if (requestedAssigneeIdsRef.current.has(assignedUserId)) return
    requestedAssigneeIdsRef.current.add(assignedUserId)
    const selectedId = assignedUserId
    const loadSelectedAssignee = async () => {
      const response = await apiCall<{ items?: UserLookup[] }>(
        `/api/auth/users?ids=${encodeURIComponent(selectedId)}&pageSize=1`,
        { headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
      ).catch(() => null)
      if (!response?.ok) return
      const user = response.result?.items?.find((item) => item.id === selectedId)
      if (!user) return
      setAssigneeLabels((current) => ({ ...current, [selectedId]: userLabel(user) }))
    }
    void loadSelectedAssignee()
  }, [assignedUserId, canReassign, users, usersLoaded])

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
        const response = await runMutation({
          operation: () => apiCall<{ assignedUserId: string | null }>(
            `/api/communication_channels/threads/${encodeURIComponent(threadId)}/assign`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ assignedUserId: nextAssignedUserId }),
            },
          ),
          context: {
            formId: CHANNEL_INFO_MUTATION_CONTEXT_ID,
            resourceKind: 'communication_channels.thread',
            resourceId: threadId,
            retryLastMutation,
          },
          mutationPayload: { assignedUserId: nextAssignedUserId },
        })
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
      } catch (err) {
        flash(
          err instanceof Error
            ? err.message
            : t('communication_channels.infoPanel.reassignError', 'Reassignment failed'),
          'error',
        )
      } finally {
        setSavingAssignee(false)
      }
    },
    [data?.threadId, retryLastMutation, runMutation, t],
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
            <Select
              value={assignedUserId ?? UNASSIGNED_VALUE}
              onValueChange={(value) =>
                void reassign(value === UNASSIGNED_VALUE ? null : value)
              }
              onOpenChange={(isOpen) => {
                if (isOpen) void loadUsers()
              }}
              disabled={savingAssignee || !data?.threadId}
            >
              <SelectTrigger
                size="xs"
                aria-label={t('communication_channels.infoPanel.assignedTo', 'Assigned to')}
              >
                <SelectValue
                  placeholder={t('communication_channels.infoPanel.unassigned', 'Unassigned')}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_VALUE}>
                  {t('communication_channels.infoPanel.unassigned', 'Unassigned')}
                </SelectItem>
                {assignedUserId && !users.some((u) => u.id === assignedUserId) ? (
                  <SelectItem value={assignedUserId}>
                    {assigneeLabels[assignedUserId] ?? assignedUserId}
                  </SelectItem>
                ) : null}
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
