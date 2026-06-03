import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

/**
 * Reactive notification handlers for the Communications Hub (Phase 4 of the
 * email integration spec).
 *
 * These handlers fire on the browser when the matching notification arrives via
 * the notifications stream. They run in addition to (not instead of) the static
 * UI surfaces:
 *
 *   - The notification appears in the user's bell dropdown via
 *     `notifications.client.ts` renderers (already wired in slice 2a).
 *   - The dropdown's primary action navigates to the reconnect URL.
 *
 * What the handlers add:
 *   - **Toast**: surfaces the message even when the user isn't looking at the
 *     bell. The reauth toast is the highest-signal interruption — without
 *     reauth the channel goes silent.
 *   - **Event emit**: lets the profile page / channel admin DataTable hook in
 *     via `useAppEvent(...)` (DOM Event Bridge) so they auto-refresh when the
 *     state flips without requiring a manual reload.
 *   - **Refresh notifications**: keeps the bell badge accurate.
 *
 * Custom event names emitted here on the DOM Event Bridge. They are published
 * for any page that opts in via `useAppEvent(...)`; no surface subscribes to
 * them today (the unified inbox auto-refreshes from the `messages.message.*`
 * bridge, and the reconnect flow is driven by the bell notification + its
 * reconnect action). Kept as forward-compatible hooks for future
 * row-highlight / refetch UX.
 */

export const CHANNEL_REQUIRES_REAUTH_EVENT = 'om:communication_channels:channel-requires-reauth'
export const MESSAGE_RECEIVED_EVENT = 'om:communication_channels:message-received'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'communication_channels.channel-requires-reauth-toast',
    notificationType: 'communication_channels.channel.requires_reauth',
    features: ['communication_channels.connect_user_channel'],
    priority: 110,
    handle(notification, context) {
      context.toast({
        title: notification.title,
        body: notification.body ?? undefined,
        severity: 'warning',
        action: {
          label:
            context.t?.(
              'communication_channels.notifications.channel_requires_reauth.reconnect',
              'Reconnect',
            ) ?? 'Reconnect',
          onClick: () => {
            const channelId = notification.sourceEntityId
            const target = channelId
              ? `/backend/profile/communication-channels?reconnect=${encodeURIComponent(channelId)}`
              : '/backend/profile/communication-channels'
            context.navigate(target)
          },
        },
      })
      context.emitEvent(CHANNEL_REQUIRES_REAUTH_EVENT, {
        notificationId: notification.id,
        channelId: notification.sourceEntityId ?? null,
      })
      context.refreshNotifications()
    },
  },
  {
    id: 'communication_channels.message-received-event',
    notificationType: 'communication_channels.message.received',
    features: ['communication_channels.view'],
    priority: 100,
    handle(notification, context) {
      // Inbox refresh is the only side effect — the user's bell dropdown already
      // shows the notification entry. A toast here would be noisy because the
      // bell badge increments anyway, and inbound email lands in the unified
      // inbox where the user expects it.
      context.emitEvent(MESSAGE_RECEIVED_EVENT, {
        notificationId: notification.id,
        messageId: notification.sourceEntityId ?? null,
      })
    },
  },
]

export default notificationHandlers
