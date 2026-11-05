import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * Type id for admin-composed one-off custom pushes (see `lib/send-custom-push.ts` +
 * `api/custom-send`). It is `hiddenFromSettings` (never listed in the client catalogue / mobile
 * preferences screen) and `nonOptOut` (an admin broadcast the user cannot pre-disable). The message
 * title/body are literal free text supplied per send, so the `titleKey`/`bodyKey` below are only
 * placeholders and are never resolved at delivery time.
 */
export const ADMIN_CUSTOM_MESSAGE_TYPE = 'admin.custom_message'

/**
 * Silent counterpart of {@link ADMIN_CUSTOM_MESSAGE_TYPE}: the type an admin "silent" one-off push is
 * labelled with (see `lib/send-custom-push.ts`). Same hidden / non-opt-out semantics, but `silent`
 * so the delivery is a data-only content-available wake-up rather than a visible banner.
 */
export const ADMIN_CUSTOM_SILENT_TYPE = 'admin.custom_silent'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: ADMIN_CUSTOM_MESSAGE_TYPE,
    module: 'push_notifications',
    titleKey: 'push_notifications.types.admin_custom_message.title',
    bodyKey: 'push_notifications.types.admin_custom_message.body',
    labelKey: 'push_notifications.types.admin_custom_message.label',
    icon: 'megaphone',
    severity: 'info',
    actions: [],
    category: 'system',
    nonOptOut: true,
    silent: false,
    hiddenFromSettings: true,
  },
  {
    type: ADMIN_CUSTOM_SILENT_TYPE,
    module: 'push_notifications',
    titleKey: 'push_notifications.types.admin_custom_silent.title',
    bodyKey: 'push_notifications.types.admin_custom_silent.body',
    labelKey: 'push_notifications.types.admin_custom_silent.label',
    icon: 'megaphone',
    severity: 'info',
    actions: [],
    category: 'system',
    nonOptOut: true,
    silent: true,
    hiddenFromSettings: true,
  },
]

export default notificationTypes
