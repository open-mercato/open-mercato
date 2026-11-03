import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Profile dropdown (top-right avatar): a discoverable entry to the per-user
 * notification-preferences page, placed directly under "Change Password" —
 * the same pattern `communication_channels` uses for its per-user
 * channel-connect page.
 */
export const injectionTable: ModuleInjectionTable = {
  'menu:topbar:profile-dropdown': [
    {
      widgetId: 'notifications.injection.profile-preferences-menu',
      priority: 90,
    },
  ],
}

export default injectionTable
