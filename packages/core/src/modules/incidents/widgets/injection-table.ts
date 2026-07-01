import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:footer': [
    { widgetId: 'incidents.injection.account-incidents', priority: 50 },
  ],
  'detail:customers.company:footer': [
    { widgetId: 'incidents.injection.account-incidents', priority: 50 },
  ],
}

export default injectionTable
