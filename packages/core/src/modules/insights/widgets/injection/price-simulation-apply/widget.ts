import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { createAppliedSimulationAfterSave } from '../../../lib/client/simulation/applyDecision'
import type { PriceFormValues } from '../../../lib/client/simulation/priceBacktest'
import PriceSimulationApplyWidget, { type PriceSimulationApplyContext } from './widget.client'

const widget: InjectionWidgetModule<PriceSimulationApplyContext, PriceFormValues> = {
  metadata: {
    id: 'insights.injection.price-simulation-apply',
    title: 'Apply price simulation',
    description: 'Records the simulation decision when the simulated catalog price row is saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['catalog'],
    priority: 100,
    enabled: true,
  },
  Widget: PriceSimulationApplyWidget,
  eventHandlers: {
    onAfterSave: createAppliedSimulationAfterSave('insights.simulation.ui.priceApply.decisionFailed'),
  },
}

export default widget
