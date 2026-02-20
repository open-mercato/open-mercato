import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:*': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
}

export default injectionTable
