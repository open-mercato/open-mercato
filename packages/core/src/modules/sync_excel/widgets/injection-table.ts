import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { syncExcelDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [syncExcelDetailWidgetSpotId]: [
    {
      widgetId: 'sync_excel.injection.upload-config',
      kind: 'tab',
      groupLabel: 'sync_excel.tabs.import',
      priority: 100,
    },
  ],
}

export default injectionTable
