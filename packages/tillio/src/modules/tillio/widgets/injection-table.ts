import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { tillioDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [tillioDetailWidgetSpotId]: [
    {
      widgetId: 'tillio.injection.operators',
      kind: 'tab',
      groupLabel: 'tillio.operators.tab',
      priority: 100,
    },
  ],
}

export default injectionTable
