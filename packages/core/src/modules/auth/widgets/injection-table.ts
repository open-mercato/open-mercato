import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'security.profile.sections': [
    {
      widgetId: 'auth.injection.accessibility-section',
      kind: 'stack',
      priority: 120,
    },
  ],
}

export default injectionTable
