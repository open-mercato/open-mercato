import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'form-header:detail': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
  'form-header:edit': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
  'crud-form:*': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
  'customers.person.detail:details': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
  'customers.company.detail:details': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
  'sales.document.detail.order:details': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
  'sales.document.detail.quote:details': [
    {
      widgetId: 'record_locks.injection.crud-form-locking',
      kind: 'stack',
      priority: 400,
    },
  ],
}

export default injectionTable
