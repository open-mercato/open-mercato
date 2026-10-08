import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:record:current': [
    {
      widgetId: 'insights.injection.record-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'version-history:entry:after': [
    {
      widgetId: 'insights.injection.log-cause',
      kind: 'stack',
      priority: 100,
    },
  ],
  'backend:access-denied:after': [
    {
      widgetId: 'insights.injection.access-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'detail:customers.deal:status-badges': [
    {
      widgetId: 'insights.injection.deal-status-why',
      kind: 'stack',
      priority: 100,
    },
  ],
}

export default injectionTable
