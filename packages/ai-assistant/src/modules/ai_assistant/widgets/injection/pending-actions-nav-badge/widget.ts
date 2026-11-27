import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PendingActionsNavBadgeWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'ai_assistant.injection.pending-actions-nav-badge',
    title: 'Pending AI actions count',
    description: 'Shows how many AI actions await approval on the Pending AI actions nav item',
    features: ['ai_assistant.view'],
    priority: 50,
    enabled: true,
  },
  Widget: PendingActionsNavBadgeWidget,
}

export default widget
