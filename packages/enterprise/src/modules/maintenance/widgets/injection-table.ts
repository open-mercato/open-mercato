import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:layout:top': [
    {
      widgetId: 'maintenance.injection.maintenance-status',
      kind: 'stack',
      priority: 1000,
    },
  ],
}

export default injectionTable
