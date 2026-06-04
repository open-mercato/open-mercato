'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ReactionGroup = {
  emoji: string
  count: number
  users: Array<{
    userId?: string | null
    externalId?: string | null
    displayName?: string | null
  }>
  reactedByMe: boolean
  myReactionId: string | null
}

type MessageWithReactions = Record<string, unknown> & {
  id?: string
  _reactions?: ReactionGroup[]
}

const REACTION_BAR_MUTATION_CONTEXT_ID = 'communication-channels-reaction-bar'

type ReactionMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export default function ReactionBarWidget({
  data,
}: InjectionWidgetComponentProps<Record<string, unknown>, MessageWithReactions>) {
  const t = useT()
  const messageId = data?.id ?? null
  const initial = React.useMemo(() => data?._reactions ?? [], [data?._reactions])
  const [groups, setGroups] = React.useState<ReactionGroup[]>(initial)
  const [busyEmoji, setBusyEmoji] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<ReactionMutationContext>({
    contextId: REACTION_BAR_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  // Keep local state in sync if the host page re-renders with fresh data.
  React.useEffect(() => setGroups(initial), [initial])

  if (!messageId || groups.length === 0) return null

  const onToggle = async (group: ReactionGroup) => {
    if (busyEmoji) return
    setBusyEmoji(group.emoji)
    try {
      if (group.reactedByMe) {
        if (!group.myReactionId) {
          flash(
            t(
              'communication_channels.reaction.cannotRemoveExternal',
              'Reactions from external participants can only be removed in the provider app.',
            ),
            'error',
          )
          return
        }
        const response = await runMutation({
          operation: () => apiCall<{ ok?: boolean; error?: string }>(
            `/api/communication_channels/messages/${messageId}/reactions/${group.myReactionId}`,
            { method: 'DELETE' },
          ),
          context: {
            formId: REACTION_BAR_MUTATION_CONTEXT_ID,
            resourceKind: 'communication_channels.message',
            resourceId: messageId,
            retryLastMutation,
          },
          mutationPayload: { action: 'remove-reaction', reactionId: group.myReactionId, emoji: group.emoji },
        })
        if (!response.ok) {
          const errBody = response.result as { error?: string } | null
          flash(
            errBody?.error
              ?? t('communication_channels.errors.reactionFailed', 'Reaction failed'),
            'error',
          )
          return
        }
        setGroups((prev) =>
          prev
            .map((g) =>
              g.emoji === group.emoji
                ? { ...g, count: Math.max(0, g.count - 1), reactedByMe: false, myReactionId: null }
                : g,
            )
            .filter((g) => g.count > 0),
        )
        return
      }
      const response = await runMutation({
        operation: () => apiCall<{ id: string; messageId: string; emoji: string }>(
          `/api/communication_channels/messages/${messageId}/reactions`,
          {
            method: 'POST',
            body: JSON.stringify({ emoji: group.emoji }),
            headers: { 'content-type': 'application/json' },
          },
        ),
        context: {
          formId: REACTION_BAR_MUTATION_CONTEXT_ID,
          resourceKind: 'communication_channels.message',
          resourceId: messageId,
          retryLastMutation,
        },
        mutationPayload: { action: 'add-reaction', emoji: group.emoji },
      })
      if (!response.ok) {
        const errBody = response.result as { error?: string } | null
        flash(
          errBody?.error
            ?? t('communication_channels.errors.reactionFailed', 'Reaction failed'),
          'error',
        )
        return
      }
      const created = response.result as { id?: string } | null
      setGroups((prev) =>
        prev.map((g) =>
          g.emoji === group.emoji
            ? {
                ...g,
                count: g.count + 1,
                reactedByMe: true,
                myReactionId: created?.id ?? g.myReactionId,
              }
            : g,
        ),
      )
    } catch (err) {
      flash(
        err instanceof Error
          ? err.message
          : t('communication_channels.errors.reactionFailed', 'Reaction failed'),
        'error',
      )
    } finally {
      setBusyEmoji(null)
    }
  }

  return (
    <div
      className="mt-2 flex flex-wrap gap-1"
      aria-label={t('communication_channels.reaction.bar.aria', 'Reactions')}
    >
      {groups.map((group) => (
        <Button
          key={group.emoji}
          type="button"
          variant={group.reactedByMe ? 'default' : 'outline'}
          size="sm"
          disabled={busyEmoji === group.emoji}
          onClick={() => void onToggle(group)}
          aria-label={t('communication_channels.reaction.toggleAria', 'Toggle {emoji} reaction', {
            emoji: group.emoji,
          })}
        >
          <span aria-hidden>{group.emoji}</span>
          <span className="ml-1 text-xs">{group.count}</span>
        </Button>
      ))}
    </div>
  )
}
