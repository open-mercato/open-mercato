import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Adds a "Notification Preferences" entry to the top-right profile dropdown,
 * next to "My communication channels". The per-user preferences page
 * (`/backend/profile/notification-preferences`) is `pageContext: 'profile'`, so
 * it is excluded from the main sidebar and otherwise only reachable via the
 * profile-mode sidebar or a direct URL — this gives it a discoverable entry.
 * Mirrors `communication_channels.injection.profile-channels-menu`.
 *
 * Feature-gated on `notifications.manage_preferences` (the same guard as the
 * page), so users who cannot edit preferences don't see a dead link. Wildcard
 * grants (`notifications.*`, `*`) are honored by the menu filter's
 * wildcard-aware matcher.
 */
const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'notifications.injection.profile-preferences-menu',
    title: 'Notification preferences profile menu item',
  },
  menuItems: [
    {
      id: 'notification-preferences-profile-link',
      labelKey: 'notifications.preferences.pageTitle',
      label: 'Notification Preferences',
      icon: 'Bell',
      href: '/backend/profile/notification-preferences',
      features: ['notifications.manage_preferences'],
      placement: { position: InjectionPosition.After, relativeTo: 'change-password' },
    },
  ],
}

export default widget
