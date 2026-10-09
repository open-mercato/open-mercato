import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:sidebar:nav:footer': {
    widgetId: 'staff.injection.timer-sidebar-indicator',
    priority: 90,
  },
  'portal:dashboard:sections': [
    {
      widgetId: 'staff.injection.portal-support-tickets',
      priority: 20,
    },
  ],
}

export default injectionTable
