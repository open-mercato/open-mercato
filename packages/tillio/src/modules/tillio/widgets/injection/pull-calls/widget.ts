import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PullCallsWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'tillio.injection.pull-calls',
    title: 'Pull calls from Tillio',
    description: 'Manually ingest phone calls from the attached Tillio operator for a chosen date range.',
    features: ['phone_calls.manage', 'integrations.manage'],
    priority: 20,
    enabled: true,
  },
  Widget: PullCallsWidget,
}

export default widget
