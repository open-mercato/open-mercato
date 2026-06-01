import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Hub widget → messages-module spot wiring (SPEC-045d §9.3).
 *
 * The Messages module exposes 4 injection spots (registered in slice 2a). The
 * hub mounts its widgets here so channel-linked messages get channel-aware
 * rendering without modifying the Messages module's templates.
 *
 * Provider packages can register additional widgets at the same spots OR
 * replace these hub-default widgets via UMES component replacement (handles
 * like `widget:communication_channels.injection.channel-badge`).
 */
export const injectionTable: ModuleInjectionTable = {
  'data-table:messages:columns': [
    {
      widgetId: 'communication_channels.injection.channel-badge',
      priority: 100,
    },
  ],
  'detail:messages:message:body:after': [
    {
      widgetId: 'communication_channels.injection.channel-payload-renderer',
      priority: 100,
    },
    {
      widgetId: 'communication_channels.injection.reaction-bar',
      priority: 90,
    },
  ],
  'detail:messages:message:sidebar': [
    {
      widgetId: 'communication_channels.injection.channel-info-panel',
      priority: 100,
    },
  ],
  // Profile dropdown (top-right avatar): a discoverable entry to the per-user
  // channel-connect page, placed directly under "Change Password".
  'menu:topbar:profile-dropdown': [
    {
      widgetId: 'communication_channels.injection.profile-channels-menu',
      priority: 100,
    },
  ],
}

export default injectionTable
