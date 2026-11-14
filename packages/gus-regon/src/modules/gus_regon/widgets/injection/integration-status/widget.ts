import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import IntegrationStatusWidget, { type IntegrationDetailData } from './widget.client'

const widget: InjectionWidgetModule<unknown, IntegrationDetailData> = {
  metadata: {
    id: 'gus_regon.injection.integration-status',
    title: 'GUS REGON status',
    features: ['gus_regon.lookup'],
    requiredModules: ['integrations'],
    priority: 100,
  },
  Widget: IntegrationStatusWidget,
}

export default widget
