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
  'data-table:phone_calls.calls:toolbar': {
    widgetId: 'tillio.injection.pull-calls',
    priority: 20,
  },
}

export default injectionTable
