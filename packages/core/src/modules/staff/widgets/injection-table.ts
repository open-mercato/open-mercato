import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:sidebar:nav:footer': {
    widgetId: 'staff.injection.timer-sidebar-indicator',
    priority: 90,
  },
  'staff.time_tracking.settings:tabs': [
    {
      widgetId: 'staff.injection.time-tracking-settings-support',
      kind: 'tab',
      groupId: 'support',
      groupLabel: 'staff.support.settings.title',
      priority: 50,
    },
  ],
  'portal:dashboard:sections': [
    {
      widgetId: 'staff.injection.portal-support-tickets',
      priority: 20,
    },
  ],
}

export default injectionTable
