import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail:tabs': [
    {
      widgetId: 'gateway_stripe.injection.config',
      kind: 'tab',
      groupLabel: 'gateway_stripe.tabs.settings',
      priority: 100,
    },
  ],
}

export default injectionTable
