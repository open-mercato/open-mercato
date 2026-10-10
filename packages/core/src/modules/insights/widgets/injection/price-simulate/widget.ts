import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { PriceFormValues } from '../../../lib/client/simulation/priceBacktest'
import PriceSimulateWidget, { type PriceSimulateContext } from './widget.client'

const widget: InjectionWidgetModule<PriceSimulateContext, PriceFormValues> = {
  metadata: {
    id: 'insights.injection.price-simulate',
    title: 'Simulate price change impact',
    description: 'Backtests the unsaved amounts of a catalog price row against recorded order and quote lines before it is saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['catalog'],
    priority: 100,
    enabled: true,
  },
  Widget: PriceSimulateWidget,
}

export default widget
