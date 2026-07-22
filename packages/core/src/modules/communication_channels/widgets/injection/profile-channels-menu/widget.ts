import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Adds a "My communication channels" entry to the top-right profile dropdown,
 * directly under "Change Password". The per-user channel-connect page
 * (`/backend/profile/communication-channels`) is `pageContext: 'profile'`, so it
 * is excluded from the main sidebar and otherwise only reachable via the
 * profile-mode sidebar or a direct URL — this gives it a discoverable entry.
 *
 * Feature-gated on `communication_channels.connect_user_channel` (the same guard
 * as the page), so users who cannot connect a channel don't see a dead link.
 * Wildcard grants (`communication_channels.*`, `*`) are honored by the menu
 * filter's wildcard-aware matcher.
 */
const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'communication_channels.injection.profile-channels-menu',
    title: 'My communication channels profile menu item',
  },
  menuItems: [
    {
      id: 'communication-channels-profile-link',
      labelKey: 'communication_channels.profile.title',
      label: 'My communication channels',
      icon: 'Mail',
      href: '/backend/profile/communication-channels',
      features: ['communication_channels.connect_user_channel'],
      placement: { position: InjectionPosition.After, relativeTo: 'change-password' },
    },
  ],
}

export default widget
