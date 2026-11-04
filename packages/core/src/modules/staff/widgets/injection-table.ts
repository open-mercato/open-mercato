import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:sidebar:nav:footer': {
    widgetId: 'staff.injection.timer-sidebar-indicator',
    priority: 90,
  },
<<<<<<< HEAD
=======
  'data-table:staff.time_entries.list:footer': {
    widgetId: 'staff.injection.time-entries-summary-footer',
    priority: 100,
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
>>>>>>> ee059779d (fix(staff): keep filtered entry totals current (#6990) (#8379))
}

export default injectionTable
