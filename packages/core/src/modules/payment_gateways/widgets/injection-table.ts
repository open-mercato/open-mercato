import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': {
    widgetId: 'payment_gateways.injection.payments-providers-menu',
    priority: 50,
  },
}

export default injectionTable
