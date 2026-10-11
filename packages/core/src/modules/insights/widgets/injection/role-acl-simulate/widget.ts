import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { RoleAclEditorValues } from '../../../lib/client/simulation/roleAclPreview'
import RoleAclSimulateWidget, { type RoleAclSimulateContext } from './widget.client'

const widget: InjectionWidgetModule<RoleAclSimulateContext, RoleAclEditorValues> = {
  metadata: {
    id: 'insights.injection.role-acl-simulate',
    title: 'Simulate role permission change',
    description: 'Previews which users and API keys would gain or lose access before a role\'s permissions are saved.',
    features: ['insights.simulator.run'],
    requiredModules: ['auth'],
    priority: 100,
    enabled: true,
  },
  Widget: RoleAclSimulateWidget,
}

export default widget
