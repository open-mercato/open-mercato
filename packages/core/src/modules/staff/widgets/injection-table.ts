import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:sidebar:nav:footer': {
    widgetId: 'staff.injection.timer-sidebar-indicator',
    priority: 90,
  },
  'data-table:staff.time_entries.list:footer': {
    widgetId: 'staff.injection.time-entries-summary-footer',
    priority: 100,
  },
}

export default injectionTable
