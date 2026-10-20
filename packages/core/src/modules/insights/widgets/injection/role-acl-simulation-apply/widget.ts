import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { createAppliedSimulationAfterSave } from '../../../lib/client/simulation/applyDecision'
import type { RoleAclEditorValues } from '../../../lib/client/simulation/roleAclPreview'
import RoleAclSimulationApplyWidget, { type RoleAclSimulationApplyContext } from './widget.client'

const widget: InjectionWidgetModule<RoleAclSimulationApplyContext, RoleAclEditorValues> = {
  metadata: {
    id: 'insights.injection.role-acl-simulation-apply',
    title: 'Apply role permission preview',
    description: 'Records the simulation decision when the previewed role permissions are saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['auth'],
    priority: 100,
    enabled: true,
  },
  Widget: RoleAclSimulationApplyWidget,
  eventHandlers: {
    onAfterSave: createAppliedSimulationAfterSave('insights.simulation.ui.roleAclApply.decisionFailed'),
  },
}

export default widget
