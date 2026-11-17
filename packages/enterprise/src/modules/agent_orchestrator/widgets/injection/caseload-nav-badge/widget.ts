import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CaseloadNavBadgeWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'agent_orchestrator.injection.caseload-nav-badge',
    title: 'Caseload pending count',
    description: 'Shows how many proposals await a human decision on the Caseload nav item',
    features: ['agent_orchestrator.proposals.view'],
    priority: 50,
    enabled: true,
  },
  Widget: CaseloadNavBadgeWidget,
}

export default widget
