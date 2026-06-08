import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:sidebar:nav:footer': {
    widgetId: 'staff.injection.timer-sidebar-indicator',
    priority: 90,
  },
}

export default injectionTable
