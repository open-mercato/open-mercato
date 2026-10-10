import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { recordAppliedSimulationAfterSave } from '../../../lib/client/simulation/applyDecision'
import type { RuleFormValues } from '../../../lib/client/simulation/ruleBacktest'
import RuleSimulationApplyWidget, { type RuleSimulationApplyContext } from './widget.client'

const widget: InjectionWidgetModule<RuleSimulationApplyContext, RuleFormValues> = {
  metadata: {
    id: 'insights.injection.rule-simulation-apply',
    title: 'Apply rule simulation',
    description: 'Records the simulation decision when the simulated business rule is saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['business_rules'],
    priority: 100,
    enabled: true,
  },
  Widget: RuleSimulationApplyWidget,
  eventHandlers: {
    onAfterSave: recordAppliedSimulationAfterSave,
  },
}

export default widget
