import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { createAppliedSimulationAfterSave } from '../../../lib/client/simulation/applyDecision'
import type { WorkflowEditorValues } from '../../../lib/client/simulation/triggerBacktest'
import WorkflowSimulationApplyWidget, { type WorkflowSimulationApplyContext } from './widget.client'

const widget: InjectionWidgetModule<WorkflowSimulationApplyContext, WorkflowEditorValues> = {
  metadata: {
    id: 'insights.injection.workflow-simulation-apply',
    title: 'Apply workflow trigger simulation',
    description: 'Records the simulation decision when the simulated workflow definition is saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['workflows'],
    priority: 100,
    enabled: true,
  },
  Widget: WorkflowSimulationApplyWidget,
  eventHandlers: {
    onAfterSave: createAppliedSimulationAfterSave('insights.simulation.ui.workflowApply.decisionFailed'),
  },
}

export default widget
