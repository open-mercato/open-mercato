import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { WorkflowEditorValues } from '../../../lib/client/simulation/triggerBacktest'
import WorkflowSimulateWidget, { type WorkflowSimulateContext } from './widget.client'

const widget: InjectionWidgetModule<WorkflowSimulateContext, WorkflowEditorValues> = {
  metadata: {
    id: 'insights.injection.workflow-simulate',
    title: 'Simulate workflow trigger impact',
    description: 'Backtests the unsaved triggers of a workflow definition against recorded events before it is saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['workflows'],
    priority: 100,
    enabled: true,
  },
  Widget: WorkflowSimulateWidget,
}

export default widget
