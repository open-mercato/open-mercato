import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { syncAkeneoDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [syncAkeneoDetailWidgetSpotId]: [
    {
      widgetId: 'sync_akeneo.injection.config',
      kind: 'tab',
      groupLabel: 'sync_akeneo.tabs.settings',
      priority: 100,
    },
  ],
}

export default injectionTable
