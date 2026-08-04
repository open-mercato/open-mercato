import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ExternalIdsWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'integrations.injection.external-ids',
    title: 'External IDs',
    features: ['integrations.view'],
  },
  Widget: ExternalIdsWidget,
}

export default widget
