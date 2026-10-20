import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { RuleFormValues } from '../../../lib/client/simulation/ruleBacktest'
import RuleSimulateWidget, { type RuleSimulateContext } from './widget.client'

const widget: InjectionWidgetModule<RuleSimulateContext, RuleFormValues> = {
  metadata: {
    id: 'insights.injection.rule-simulate',
    title: 'Simulate rule impact',
    description: 'Backtests the unsaved business rule against recorded events before it is saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['business_rules'],
    priority: 100,
    enabled: true,
  },
  Widget: RuleSimulateWidget,
}

export default widget
