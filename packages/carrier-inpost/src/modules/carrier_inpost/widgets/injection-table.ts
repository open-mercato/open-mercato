import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { carrierInpostDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [carrierInpostDetailWidgetSpotId]: [
    {
      widgetId: 'carrier_inpost.injection.config',
      kind: 'tab',
      groupLabel: 'carrier_inpost.tabs.settings',
      priority: 100,
    },
  ],
}

export default injectionTable
