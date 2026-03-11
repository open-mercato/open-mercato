import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { gatewayStripeDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [gatewayStripeDetailWidgetSpotId]: [
    {
      widgetId: 'gateway_stripe.injection.config',
      kind: 'tab',
      groupLabel: 'gateway_stripe.tabs.settings',
      priority: 100,
    },
  ],
}

export default injectionTable
